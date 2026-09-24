// service-manifest.test.mjs — unit tests for the preview Cloud Run deployment
// contract (BJJ-341). Node built-ins only; parses the fixed Knative manifest
// structure with a small purpose-built YAML-subset parser.
//
// Run: node --test backend/deploy/cloudrun/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "service.preview.yaml");
const excludedPath = join(here, "excluded-keys.txt");
const envTplPath = join(here, "..", "..", "env.tpl");
const scriptPath = join(here, "sync-secrets.sh");

// ---------------------------------------------------------------- YAML subset

// Removes a trailing comment: '#' at line start or preceded by whitespace,
// never inside single/double quotes.
function stripComment(raw) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === "#" && !inSingle && !inDouble) {
            if (i === 0 || /[ \t]/.test(raw[i - 1])) return raw.slice(0, i);
        }
    }
    return raw;
}

function tokenize(text) {
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
        const clean = stripComment(raw);
        if (clean.trim() === "") continue;
        const indent = clean.length - clean.trimStart().length;
        lines.push({ indent, content: clean.trim() });
    }
    return lines;
}

// Index of the colon that ends a mapping key (first ':' followed by space/EOL).
function findKeyColon(s) {
    const m = /^([^:]+):(?:\s|$)/.exec(s);
    return m ? m[1].length : -1;
}

function parseScalar(s) {
    if (
        s.length >= 2 &&
        ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    ) {
        return s.slice(1, -1);
    }
    return s;
}

function parseNode(lines, pos, indent) {
    const line = lines[pos.i];
    if (line.content === "-" || line.content.startsWith("- ")) {
        return parseSeq(lines, pos, indent);
    }
    return parseMap(lines, pos, indent);
}

function parseMap(lines, pos, indent) {
    const map = {};
    while (pos.i < lines.length) {
        const line = lines[pos.i];
        if (line.indent < indent) break;
        if (line.content === "-" || line.content.startsWith("- ")) break;
        if (line.indent > indent) throw new Error(`unexpected indent near: ${line.content}`);
        const idx = findKeyColon(line.content);
        if (idx === -1) throw new Error(`not a mapping line: ${line.content}`);
        const key = line.content.slice(0, idx).trim();
        const rest = line.content.slice(idx + 1).trim();
        pos.i += 1;
        if (rest !== "") {
            map[key] = parseScalar(rest);
            continue;
        }
        if (pos.i >= lines.length) {
            map[key] = null;
            continue;
        }
        const next = lines[pos.i];
        if (next.indent > indent) {
            map[key] = parseNode(lines, pos, next.indent);
        } else if (next.indent === indent && (next.content === "-" || next.content.startsWith("- "))) {
            map[key] = parseSeq(lines, pos, indent);
        } else {
            map[key] = null;
        }
    }
    return map;
}

function parseSeq(lines, pos, indent) {
    const items = [];
    while (pos.i < lines.length) {
        const line = lines[pos.i];
        if (line.indent !== indent || !(line.content === "-" || line.content.startsWith("- "))) break;
        if (line.content === "-") {
            pos.i += 1;
            if (pos.i < lines.length && lines[pos.i].indent > indent) {
                items.push(parseNode(lines, pos, lines[pos.i].indent));
            } else {
                items.push(null);
            }
            continue;
        }
        const inline = line.content.slice(2).trim();
        if (findKeyColon(inline) === -1) {
            items.push(parseScalar(inline));
            pos.i += 1;
            continue;
        }
        // Re-anchor the inline mapping at the column right after "- " so the
        // item's remaining keys (aligned there) join the same mapping.
        lines[pos.i] = { indent: indent + 2, content: inline };
        items.push(parseMap(lines, pos, indent + 2));
    }
    return items;
}

function parseYaml(text) {
    const lines = tokenize(text);
    if (lines.length === 0) return null;
    const pos = { i: 0 };
    const root = parseNode(lines, pos, lines[0].indent);
    if (pos.i !== lines.length) throw new Error(`trailing content near: ${lines[pos.i].content}`);
    return root;
}

// -------------------------------------------------------------------- helpers

function parseEnvTplKeys(text) {
    const keys = new Set();
    const keyRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
    let lineno = 0;
    for (const raw of text.split(/\r?\n/)) {
        lineno += 1;
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        assert.ok(eq > 0, `backend/env.tpl line ${lineno}: not a KEY=... line`);
        const key = line.slice(0, eq).trim();
        assert.match(key, keyRe, `backend/env.tpl line ${lineno}: invalid key`);
        keys.add(key);
    }
    return keys;
}

function parseExcluded(text) {
    const entries = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;
        const hash = line.indexOf("#");
        if (hash === -1) {
            entries.push({ key: line, reason: "" });
            continue;
        }
        entries.push({ key: line.slice(0, hash).trim(), reason: line.slice(hash + 1).trim() });
    }
    return entries;
}

function containerEnv() {
    const containers = manifest.spec.template.spec.containers;
    assert.ok(Array.isArray(containers), "spec.template.spec.containers missing");
    assert.equal(containers.length, 1, "exactly one container expected");
    const envList = Array.isArray(containers[0].env) ? containers[0].env : [];
    const plain = new Map();
    const secrets = [];
    const plainOrder = [];
    const secretOrder = [];
    for (const entry of envList) {
        assert.ok(entry && typeof entry === "object" && typeof entry.name === "string",
            "env entry must be an object with a name");
        if (entry.valueFrom !== undefined) {
            const ref = entry.valueFrom?.secretKeyRef;
            assert.ok(ref, `env ${entry.name}: expected valueFrom.secretKeyRef`);
            assert.equal(ref.key, "latest", `env ${entry.name}: secretKeyRef key must be "latest"`);
            assert.equal(ref.name, entry.name, `env ${entry.name}: secret id must equal the env var name`);
            secrets.push(entry.name);
            secretOrder.push(entry.name);
        } else {
            assert.ok(entry.value !== undefined, `env ${entry.name}: needs value or valueFrom`);
            assert.equal(typeof entry.value, "string", `env ${entry.name}: value must be a string`);
            plain.set(entry.name, entry.value);
            plainOrder.push(entry.name);
        }
    }
    return { plain, plainOrder, secrets, secretOrder };
}

// Shared expectations (kept next to the assertions that consume them).

const EXPECTED_PLAIN_ENV = new Map([
    ["NODE_ENV", "production"],
    ["APP_HOST", "0.0.0.0"],
    ["APP_PORT", "3001"],
    ["DATABASE_CONNECTION_MODE", "shared"],
    ["TENANT_ISOLATION_MODE", "observe"],
    ["SCHEDULERS_ENABLED", "false"],
    ["SCHEDULER_LEASE_MODE", "off"],
    ["SCHEDULER_LEASE_HOLDER_ID", "preview"],
    ["EFORMSIGN_RECONCILE_ALLOW_UNLOCKED", "false"],
    ["SERVICE_RECORD_AUTO_FINALIZE_ENABLED", "false"],
    ["PREVIEW_FRONTEND_URL", "https://preview.admin.babyjamjam.com"],
    ["PRODUCTION_FRONTEND_URL", "https://preview.admin.babyjamjam.com"],
    ["PRODUCTION_MOBILE_FRONTEND_URL", "https://preview.m.admin.babyjamjam.com"],
    ["SENTRY_ENVIRONMENT", "preview"],
    ["ALIGO_API_KEY", ""],
    ["ALIGO_USER_ID", ""],
    ["ALIGO_SENDER_PHONE", ""],
]);

// Secrets the backend reads that env.tpl does not list. Deployed anyway.
// Empty since BJJ-341 (unit F): the two former entries — SENTRY_DSN and
// AUTH_EMAIL_TOKEN_HMAC_SECRET — are intentionally NOT deployed (see the
// dedicated test below). The mechanism stays so a future runtime-only secret
// can be added here with a reason.
const RUNTIME_ONLY_SECRETS = {};

const manifestText = readFileSync(manifestPath, "utf8");
const manifest = parseYaml(manifestText);
const envTplKeys = parseEnvTplKeys(readFileSync(envTplPath, "utf8"));
const excludedEntries = parseExcluded(readFileSync(excludedPath, "utf8"));
const { plain, plainOrder, secrets, secretOrder } = containerEnv();
const secretSet = new Set(secrets);

// Restricted PATH: dry-run and guard paths must never invoke gcloud; under
// this PATH an accidental call fails loudly instead of succeeding.
function runScript(envFile, extraArgs = []) {
    return spawnSync(scriptPath, [envFile, "test-project", ...extraArgs], {
        encoding: "utf8",
        env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
}

// ------------------------------------------------- stub gcloud (real sync path)

// Writes an executable bash stub named `gcloud` (bash 3.2 compatible, macOS
// /bin/bash) into binDir. It keeps a per-key version store under storeDir and
// appends its argv (never stdin) to storeDir/argv.log. It implements exactly
// the argument orders sync-secrets.sh uses:
//   gcloud secrets describe KEY --project=...
//   gcloud secrets create KEY --project=... --replication-policy=automatic
//   gcloud secrets versions access latest --secret=KEY --project=...
//   gcloud secrets versions add KEY --project=... --data-file=-
function writeStubGcloud(binDir, storeDir) {
    mkdirSync(binDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    const stub = [
        "#!/bin/bash",
        "# Test stub for gcloud: per-key version store in a temp directory.",
        "# Records argv only; stdin bytes go to version files, never to the log.",
        `STORE="${storeDir}"`,
        `LOG="${storeDir}/argv.log"`,
        'printf \'%s\\n\' "$*" >> "$LOG"',
        'cmd="$2"',
        'case "$cmd" in',
        "  describe)",
        '    [ -d "$STORE/keys/$3" ] && exit 0',
        "    exit 1",
        "    ;;",
        "  create)",
        '    mkdir -p "$STORE/keys/$3"',
        '    echo 0 > "$STORE/keys/$3/latest"',
        "    exit 0",
        "    ;;",
        "  versions)",
        '    sub="$3"',
        '    if [ "$sub" = "add" ]; then',
        '      key="$4"',
        '      datafile=""',
        '      for a in "$@"; do',
        '        case "$a" in',
        '          --data-file=*) datafile="${a#--data-file=}" ;;',
        "        esac",
        "      done",
        '      if [ "$datafile" = "-" ]; then',
        '        dir="$STORE/keys/$key"',
        '        mkdir -p "$dir"',
        '        next=$(( $(cat "$dir/latest" 2>/dev/null || echo 0) + 1 ))',
        '        cat > "$dir/v$next"',
        '        echo "$next" > "$dir/latest"',
        "        exit 0",
        "      fi",
        "      exit 1",
        '    elif [ "$sub" = "access" ]; then',
        '      secret=""',
        '      for a in "$@"; do',
        '        case "$a" in',
        '          --secret=*) secret="${a#--secret=}" ;;',
        "        esac",
        "      done",
        '      dir="$STORE/keys/$secret"',
        '      if [ -d "$dir" ]; then',
        '        latest="$(cat "$dir/latest" 2>/dev/null || echo 0)"',
        '        if [ "$latest" != "0" ] && [ -f "$dir/v$latest" ]; then',
        '          cat "$dir/v$latest"',
        "          exit 0",
        "        fi",
        "      fi",
        "      exit 1",
        "    fi",
        "    exit 1",
        "    ;;",
        "  *)",
        "    exit 1",
        "    ;;",
        "esac",
    ];
    const gcloud = join(binDir, "gcloud");
    writeFileSync(gcloud, stub.join("\n") + "\n");
    chmodSync(gcloud, 0o755);
}

// Runs the script with the stub gcloud FIRST on PATH (shasum still resolves
// from /usr/bin).
function stubRun(envFile, binDir, extraArgs = []) {
    return spawnSync(scriptPath, [envFile, "test-project", ...extraArgs], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` },
    });
}

function stubLatestVersion(storeDir, key) {
    return readFileSync(join(storeDir, "keys", key, "latest"), "utf8").trim();
}

function stubVersionCount(storeDir, key) {
    return readdirSync(join(storeDir, "keys", key)).filter((f) => /^v\d+$/.test(f)).length;
}

function stubLatestBytes(storeDir, key) {
    return readFileSync(join(storeDir, "keys", key, `v${stubLatestVersion(storeDir, key)}`));
}

function makeTempEnvFile(testName, lines) {
    const dir = mkdtempSync(join(tmpdir(), `cloudrun-manifest-${testName}-`));
    const file = join(dir, "backend.env");
    writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
    return { dir, file };
}

// sync-secrets.sh validates KAKAO_CALLBACK_URL's shape, so its dummy is a
// run.app callback URL that still carries the dummy marker for leak checks.
function dummyValue(name) {
    const v = `dummy-${name}-value`;
    return name === "KAKAO_CALLBACK_URL" ? `https://${v}.a.run.app/auth/kakao/callback` : v;
}

// The "x=" form would break the callback URL shape; use the quoted form there.
function dummyForm(name, i) {
    return name === "KAKAO_CALLBACK_URL" && i % 4 === 2 ? 0 : i % 4;
}

function dummyLine(name, i) {
    const v = dummyValue(name);
    switch (dummyForm(name, i)) {
        case 0: return `${name}="${v}"`;
        case 1: return `export ${name}=${v}`;
        case 2: return `${name}=x=${v}=end`;
        default: return `${name}='${v}'`;
    }
}

function assertNoDummyValues(combined, names) {
    for (const name of names) {
        assert.ok(!combined.includes(`dummy-${name}-value`),
            `dummy value for ${name} must never be printed`);
    }
}

// ---------------------------------------------------------------------- tests

test("safety invariants of the preview service manifest", () => {
    assert.equal(manifest.apiVersion, "serving.knative.dev/v1");
    assert.equal(manifest.kind, "Service");
    assert.equal(manifest.metadata.name, "babyjamjam-api-preview");
    assert.equal(manifest.metadata.labels["cloud.googleapis.com/location"], "asia-northeast3");

    const annotations = manifest.spec.template.metadata.annotations;
    assert.equal(annotations["autoscaling.knative.dev/minScale"], "0");
    assert.equal(annotations["autoscaling.knative.dev/maxScale"], "1");

    const tplSpec = manifest.spec.template.spec;
    assert.equal(tplSpec.containerConcurrency, "8");
    assert.equal(tplSpec.timeoutSeconds, "300");

    const container = tplSpec.containers[0];
    assert.equal(container.ports[0].name, "http1");
    assert.equal(container.ports[0].containerPort, "3001");
    assert.equal(container.startupProbe.httpGet.path, "/health");
    const probe = container.startupProbe;
    // Cloud Run caps the startup-probe window at 240s; initialDelaySeconds
    // (default 0) counts toward it, so it must be part of the budget.
    const initialDelaySeconds = probe.initialDelaySeconds === undefined ? 0 : Number(probe.initialDelaySeconds);
    assert.ok(
        initialDelaySeconds + Number(probe.periodSeconds) * Number(probe.failureThreshold) <= 240,
        "startup probe budget (initialDelaySeconds + periodSeconds * failureThreshold) must stay within the 240s Cloud Run cap",
    );
    assert.ok(
        Number(probe.timeoutSeconds) <= Number(probe.periodSeconds),
        "startup probe timeoutSeconds must not exceed periodSeconds",
    );
    assert.equal(
        String(probe.httpGet.port),
        String(container.ports[0].containerPort),
        "startup probe port must target the container port",
    );

    assert.equal(plain.get("SCHEDULERS_ENABLED"), "false");
    assert.equal(plain.get("SCHEDULER_LEASE_MODE"), "off");
    assert.equal(plain.get("EFORMSIGN_RECONCILE_ALLOW_UNLOCKED"), "false");
    assert.equal(plain.get("APP_PORT"), "3001");
});

test("service-level ingress stays absent or all (Vercel server calls and browser Kakao navigation must reach it)", () => {
    const ingress = manifest.metadata.annotations?.["run.googleapis.com/ingress"];
    assert.ok(
        ingress === undefined || ingress === "all",
        `metadata.annotations["run.googleapis.com/ingress"] must be absent or "all" (got: ${JSON.stringify(ingress)})`,
    );
});

test("plain env is exactly the agreed literal set (Aligo blanked, preview passive)", () => {
    assert.deepEqual(plain, EXPECTED_PLAIN_ENV);
    assert.deepEqual(plainOrder, [...EXPECTED_PLAIN_ENV.keys()]);
});

test("serviceAccountName uses the preview runtime identity", () => {
    assert.equal(
        manifest.spec.template.spec.serviceAccountName,
        "babyjamjam-preview-runtime@${PROJECT_ID}.iam.gserviceaccount.com",
    );
});

test("only ${IMAGE} and ${PROJECT_ID} placeholders exist and no other $ remains", () => {
    const placeholderRe = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    const names = [...manifestText.matchAll(placeholderRe)].map((m) => m[1]);
    assert.ok(names.includes("IMAGE"), "${IMAGE} placeholder missing");
    assert.ok(names.includes("PROJECT_ID"), "${PROJECT_ID} placeholder missing");
    for (const name of names) {
        assert.ok(name === "IMAGE" || name === "PROJECT_ID", `unexpected placeholder: ${name}`);
    }
    const leftovers = manifestText.replace(placeholderRe, "");
    assert.ok(!leftovers.includes("$"), "found a $ outside the two placeholders");
});

test("every secret key exists in backend/env.tpl or is a RUNTIME_ONLY key", () => {
    // RUNTIME_ONLY keys are deliberately absent from env.tpl; the "every
    // secret is in env.tpl or in RUNTIME_ONLY" test asserts each entry with
    // its reason. SENTRY_DSN and AUTH_EMAIL_TOKEN_HMAC_SECRET are covered by
    // their dedicated not-deployed test instead.
    for (const name of secrets) {
        const known = envTplKeys.has(name) || RUNTIME_ONLY_SECRETS[name] !== undefined;
        assert.ok(known, `secret ${name} is neither in backend/env.tpl nor RUNTIME_ONLY`);
    }
});

test("no key is both plain and secret; no duplicate keys", () => {
    for (const name of plainOrder) {
        assert.ok(!secretSet.has(name), `key ${name} is both plain and secret`);
    }
    assert.equal(new Set(plainOrder).size, plainOrder.length, "duplicate plain env keys");
    assert.equal(new Set(secretOrder).size, secretOrder.length, "duplicate secret keys");
});

test("reverse completeness: every env.tpl key is plain, secret, or excluded (with reason)", () => {
    const excludedKeys = new Set(excludedEntries.map((e) => e.key));
    for (const key of envTplKeys) {
        const classified = plain.has(key) || secretSet.has(key) || excludedKeys.has(key);
        assert.ok(classified, `env.tpl key ${key} is not plain, secret, or excluded`);
    }
    for (const entry of excludedEntries) {
        assert.match(entry.key, /^[A-Za-z_][A-Za-z0-9_]*$/, `bad excluded key: ${entry.key}`);
        assert.ok(entry.reason.length > 0, `excluded key ${entry.key} needs a "# reason"`);
    }
});

test("every secret is in env.tpl or in RUNTIME_ONLY (with reason per key)", () => {
    for (const name of secrets) {
        if (!envTplKeys.has(name)) {
            assert.ok(RUNTIME_ONLY_SECRETS[name] !== undefined,
                `secret ${name} is neither in env.tpl nor in RUNTIME_ONLY_SECRETS`);
            assert.ok(RUNTIME_ONLY_SECRETS[name].length > 0);
        }
    }
    for (const name of Object.keys(RUNTIME_ONLY_SECRETS)) {
        assert.ok(secretSet.has(name), `RUNTIME_ONLY secret ${name} must be deployed`);
    }
});

test("SENTRY_DSN and AUTH_EMAIL_TOKEN_HMAC_SECRET are intentionally not deployed", () => {
    // Operator decision 2026-09-23: preview mirrors production's credentials,
    // and production's backend env contains NEITHER key (verified by key
    // listing on the production host).
    // - SENTRY_DSN unset → Sentry activates only when the DSN is set, so it is
    //   off on the production backend; preview mirrors that.
    // - AUTH_EMAIL_TOKEN_HMAC_SECRET unset →
    //   backend/application/services/auth-email-token.service.ts falls back to
    //   JWT_SECRET. Preview uses production's JWT_SECRET, so email-token HMACs
    //   stay identical to production — required because production's outbox
    //   worker rebuilds tokens with its own secret over the shared DB.
    for (const name of ["SENTRY_DSN", "AUTH_EMAIL_TOKEN_HMAC_SECRET"]) {
        assert.ok(!secretSet.has(name), `${name} must not be deployed as a secret`);
        assert.ok(!plain.has(name), `${name} must not be deployed as plain env`);
    }
});

test("Aligo keys are plain empty strings (not secrets); reconcile unlock stays off", () => {
    for (const key of ["ALIGO_API_KEY", "ALIGO_USER_ID", "ALIGO_SENDER_PHONE"]) {
        assert.equal(plain.get(key), "", `${key} must be a plain empty string`);
        assert.ok(!secretSet.has(key), `${key} must not be a secret`);
    }
    assert.equal(plain.get("EFORMSIGN_RECONCILE_ALLOW_UNLOCKED"), "false");
});

test("sync-secrets.sh --dry-run prints would-sync for every key and leaks no values", () => {
    const lines = secrets.map((name, i) => dummyLine(name, i));
    const { dir, file } = makeTempEnvFile("dryrun", lines);
    try {
        const res = runScript(file, ["--dry-run"]);
        assert.equal(res.status, 0, `exit ${res.status}; stderr: ${res.stderr}`);
        const outLines = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        assert.deepEqual(outLines.sort(), secrets.map((k) => `${k}: would-sync`).sort());
        assertNoDummyValues(res.stdout + res.stderr, secrets);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("sync-secrets.sh fails when a secret is missing or empty, naming only the key", () => {
    const missing = secrets[0];
    const lines = secrets.slice(1).map((name, i) => dummyLine(name, i));
    const a = makeTempEnvFile("missing", lines);
    try {
        const res = runScript(a.file);
        assert.equal(res.status, 1);
        const combined = res.stdout + res.stderr;
        assert.ok(combined.includes(missing), `must name the missing key ${missing}`);
        assertNoDummyValues(combined, secrets.slice(1));
    } finally {
        rmSync(a.dir, { recursive: true, force: true });
    }

    const emptied = secrets[1];
    const lines2 = secrets.map((name, i) => (name === emptied ? `${name}=` : dummyLine(name, i)));
    const b = makeTempEnvFile("empty", lines2);
    try {
        const res = runScript(b.file);
        assert.equal(res.status, 1);
        const combined = res.stdout + res.stderr;
        assert.ok(combined.includes(emptied), `must name the empty key ${emptied}`);
        assertNoDummyValues(combined, secrets.filter((n) => n !== emptied));
    } finally {
        rmSync(b.dir, { recursive: true, force: true });
    }
});

test("undeployed env keys exit 3 without --allow-undeployed and 0 with it", () => {
    const lines = [...secrets.map((name, i) => dummyLine(name, i)), "SOME_NEW_KEY=dummyvalue-extra"];
    const { dir, file } = makeTempEnvFile("undeployed", lines);
    try {
        const res = runScript(file);
        assert.equal(res.status, 3);
        const combined = res.stdout + res.stderr;
        assert.ok(combined.includes("not-deployed: SOME_NEW_KEY"));
        assert.ok(!combined.includes("dummyvalue-extra"), "value of the undeployed key must not print");

        const allowed = runScript(file, ["--dry-run", "--allow-undeployed"]);
        assert.equal(allowed.status, 0);
        const outLines = allowed.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        assert.deepEqual(outLines.sort(), secrets.map((k) => `${k}: would-sync`).sort());
        assert.ok(!allowed.stdout.includes("SOME_NEW_KEY"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("sync-secrets.sh rejects a KAKAO_CALLBACK_URL that is not a run.app callback, naming only the key", () => {
    for (const bad of [
        "https://api.babyjamjam.com/auth/kakao/callback",
        "https://dummy-kakao-value.a.run.app/auth/kakao/callback/extra",
        "http://dummy-kakao-value.a.run.app/auth/kakao/callback",
        "https://api.babyjamjam.com/x.run.app/auth/kakao/callback",
        "xhttps://dummy-kakao-value.a.run.app/auth/kakao/callback",
    ]) {
        const lines = secrets.map((name, i) => (name === "KAKAO_CALLBACK_URL" ? `${name}=${bad}` : dummyLine(name, i)));
        const { dir, file } = makeTempEnvFile("kakao", lines);
        try {
            const res = runScript(file, ["--dry-run"]);
            assert.equal(res.status, 1, `expected exit 1 for ${bad}; stderr: ${res.stderr}`);
            const combined = res.stdout + res.stderr;
            assert.ok(combined.includes("invalid-preview-value: KAKAO_CALLBACK_URL"));
            assert.ok(!combined.includes(bad), "the rejected value must never be printed");
            assert.ok(!combined.includes("would-sync"), "must fail before listing any sync");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test("sync-secrets.sh accepts a real regional Cloud Run callback URL", () => {
    const real = "https://babyjamjam-api-preview-123456789012.asia-northeast3.run.app/auth/kakao/callback";
    const lines = secrets.map((name, i) => (name === "KAKAO_CALLBACK_URL" ? `${name}=${real}` : dummyLine(name, i)));
    const { dir, file } = makeTempEnvFile("kakao-real", lines);
    try {
        const res = runScript(file, ["--dry-run"]);
        assert.equal(res.status, 0, `exit ${res.status}; stderr: ${res.stderr}`);
        assert.ok(!res.stderr.includes("invalid-preview-value"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("malformed env lines report only the line number and never the content", () => {
    const [k1, k2, k3] = secrets;
    const lines = [
        "# a comment line",
        `${k1}="dummyvalue-bad"`,
        `${k2}=dummyvalue-bad`,
        "this line has no equals sign dummyvalue-bad",
        `${k3}=dummyvalue-bad`,
    ];
    const { dir, file } = makeTempEnvFile("malformed", lines);
    try {
        const res = runScript(file);
        assert.equal(res.status, 1);
        const combined = res.stdout + res.stderr;
        assert.ok(combined.includes("line 4: invalid"), `expected "line 4: invalid", got: ${combined}`);
        assert.ok(!combined.includes("dummyvalue-bad"), "dummy value must never be printed");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    const lines2 = [`${secrets[0]}=dummyvalue-bad`, "BAD-KEY=another dummyvalue-bad"];
    const b = makeTempEnvFile("badkey", lines2);
    try {
        const res = runScript(b.file);
        assert.equal(res.status, 1);
        const combined = res.stdout + res.stderr;
        assert.ok(combined.includes("line 2: invalid"));
        assert.ok(!combined.includes("dummyvalue-bad"));
    } finally {
        rmSync(b.dir, { recursive: true, force: true });
    }
});

// Decoded value of each dummyLine form: the quoted and export forms decode to
// the plain value; the "x=" form proves values containing "=" survive the
// first-"=" split (only the first "=" separates key from value).
function intendedDummyValue(name, i) {
    const v = dummyValue(name);
    return dummyForm(name, i) === 2 ? `x=${v}=end` : v;
}

test("sync-secrets.sh real (non-dry-run) path via stub gcloud: created/unchanged/updated, values never leak", () => {
    const root = mkdtempSync(join(tmpdir(), "cloudrun-syncstub-"));
    const binDir = join(root, "bin");
    const storeDir = join(root, "store");
    const envFile = join(root, "backend.env");
    try {
        writeStubGcloud(binDir, storeDir);

        // Duplicate key: the LAST occurrence must win (dotenv semantics).
        const dupKey = secrets[3];
        const dupValue = `dummy-${dupKey}-dupvalue`;
        const lines = secrets.map((name, i) => dummyLine(name, i));
        lines.push(`${dupKey}=${dupValue}`);
        writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });

        const expected = new Map(secrets.map((name, i) => [name, intendedDummyValue(name, i)]));
        expected.set(dupKey, dupValue);

        // Run 1 — nothing exists yet: every key is created with exact bytes.
        const r1 = stubRun(envFile, binDir);
        assert.equal(r1.status, 0, `exit ${r1.status}; stderr: ${r1.stderr}`);
        const out1 = r1.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        assert.deepEqual(out1.sort(), secrets.map((k) => `${k}: created`).sort());
        for (const [key, value] of expected) {
            assert.ok(stubLatestBytes(storeDir, key).equals(Buffer.from(value, "utf8")),
                `stored bytes for ${key} must equal the intended dummy value`);
        }

        // Run 2 — unchanged input: nothing is touched, no new versions.
        const r2 = stubRun(envFile, binDir);
        assert.equal(r2.status, 0, `exit ${r2.status}; stderr: ${r2.stderr}`);
        const out2 = r2.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        assert.deepEqual(out2.sort(), secrets.map((k) => `${k}: unchanged`).sort());
        for (const key of secrets) {
            assert.equal(stubVersionCount(storeDir, key), 1,
                `${key} must gain no new version on an unchanged re-run`);
        }

        // Run 3 — rotate exactly one value: exactly that key updates, with
        // exactly one new version.
        const changedKey = secrets[0];
        const rotatedValue = `rotated-${changedKey}-secret`;
        const lines3 = secrets.map((name, i) =>
            name === changedKey ? `${name}=${rotatedValue}` : dummyLine(name, i));
        lines3.push(`${dupKey}=${dupValue}`); // duplicate still present: last wins
        writeFileSync(envFile, lines3.join("\n") + "\n", { mode: 0o600 });
        const r3 = stubRun(envFile, binDir);
        assert.equal(r3.status, 0, `exit ${r3.status}; stderr: ${r3.stderr}`);
        const out3 = r3.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const expected3 = secrets.map((k) => `${k}: ${k === changedKey ? "updated" : "unchanged"}`);
        assert.deepEqual(out3.sort(), expected3.sort());
        assert.equal(stubVersionCount(storeDir, changedKey), 2,
            "the changed key must gain exactly one new version");
        assert.ok(stubLatestBytes(storeDir, changedKey).equals(Buffer.from(rotatedValue, "utf8")));
        for (const key of secrets.slice(1)) {
            assert.equal(stubVersionCount(storeDir, key), 1, `${key} must not gain a version`);
        }

        // No dummy value ever reaches stdout, stderr, or the stub's argv log
        // (the script must move values through stdin only).
        const argvLog = readFileSync(join(storeDir, "argv.log"), "utf8");
        const forbidden = secrets.map((name) => `dummy-${name}-value`);
        forbidden.push(dupValue, rotatedValue);
        for (const out of [r1.stdout + r1.stderr, r2.stdout + r2.stderr, r3.stdout + r3.stderr, argvLog]) {
            for (const s of forbidden) {
                assert.ok(!out.includes(s), "secret value material must never be printed or logged");
            }
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("parser matches dotenv: trims value whitespace before unquoting; refuses unquoted ' #' fail-closed", () => {
    const root = mkdtempSync(join(tmpdir(), "cloudrun-parse-"));
    const binDir = join(root, "bin");
    const storeDir = join(root, "store");
    const envFile = join(root, "backend.env");
    const write = (ls) => writeFileSync(envFile, ls.join("\n") + "\n", { mode: 0o600 });
    try {
        writeStubGcloud(binDir, storeDir);
        const [k1, k2, k3] = secrets;
        // The real sync path requires every manifest secret to be present, so
        // each syncable env file pads the uninteresting keys with dummies.
        const padLines = (...skip) =>
            secrets.filter((n) => !skip.includes(n)).map((n, i) => dummyLine(n, i));

        // KEY= spaced  ->  "spaced";  KEY= "q"  ->  q
        write([`${k1}=  spaced-${k1}  `, `${k2}=  "quoted-${k2}"`, ...padLines(k1, k2)]);
        const r = stubRun(envFile, binDir);
        assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr}`);
        assert.ok(stubLatestBytes(storeDir, k1).equals(Buffer.from(`spaced-${k1}`, "utf8")),
            "surrounding whitespace must be trimmed before the value is stored");
        assert.ok(stubLatestBytes(storeDir, k2).equals(Buffer.from(`quoted-${k2}`, "utf8")),
            'whitespace before an opening quote must not end up in the value');

        // Quoted values keep "#" literally.
        write([`${k1}="hash-${k1} # not-a-comment"`, ...padLines(k1)]);
        const rq = stubRun(envFile, binDir);
        assert.equal(rq.status, 0, `exit ${rq.status}; stderr: ${rq.stderr}`);
        assert.ok(stubLatestBytes(storeDir, k1).equals(Buffer.from(`hash-${k1} # not-a-comment`, "utf8")),
            "a quoted value must keep '#' literally");

        // Unquoted " #" (space-hash): refuse the line, print only line+verdict,
        // and never reach gcloud with any value. k1 and k3 both have changed
        // values pending, so a non-aborting run would add versions for them.
        const poison = `poison-${k3}-value`;
        const k1Versions = stubVersionCount(storeDir, k1);
        const k3Versions = stubVersionCount(storeDir, k3);
        write([`${k1}=ok-${k1}`, `${k3}=${poison} # trailing comment`]);
        const rx = stubRun(envFile, binDir);
        assert.equal(rx.status, 1);
        const combined = rx.stdout + rx.stderr;
        assert.ok(combined.includes("line 2: invalid"), `expected "line 2: invalid", got: ${combined}`);
        assert.ok(!combined.includes(poison), "refused value must never be printed");
        assert.equal(stubVersionCount(storeDir, k1), k1Versions,
            "a refused file must abort before any secret version is added");
        assert.equal(stubVersionCount(storeDir, k3), k3Versions,
            "a refused file must abort before any secret version is added");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
