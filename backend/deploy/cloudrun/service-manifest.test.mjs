// service-manifest.test.mjs — unit tests for the preview Cloud Run deployment
// contract (BJJ-341). Node built-ins only; parses the fixed Knative manifest
// structure with a small purpose-built YAML-subset parser.
//
// Run: node --test backend/deploy/cloudrun/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    ["PREVIEW_FRONTEND_URL", "https://staff.babyjamjam.com"],
    ["PRODUCTION_FRONTEND_URL", "https://staff.babyjamjam.com"],
    ["SENTRY_ENVIRONMENT", "preview"],
    ["ALIGO_API_KEY", ""],
    ["ALIGO_USER_ID", ""],
    ["ALIGO_SENDER_PHONE", ""],
]);

// Secrets the backend reads that env.tpl does not list. Deployed anyway.
const RUNTIME_ONLY_SECRETS = {
    SENTRY_DSN: "Sentry activates only when the DSN is set; backend reads it but env.tpl omits it",
    AUTH_EMAIL_TOKEN_HMAC_SECRET: "read by backend/application/services/auth-email-token.service.ts; absent from env.tpl",
};

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

function makeTempEnvFile(testName, lines) {
    const dir = mkdtempSync(join(tmpdir(), `cloudrun-manifest-${testName}-`));
    const file = join(dir, "backend.env");
    writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
    return { dir, file };
}

function dummyLine(name, i) {
    const v = `dummy-${name}-value`;
    switch (i % 4) {
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
    assert.ok(container.startupProbe.timeoutSeconds * container.startupProbe.failureThreshold <= 240,
        "startup probe budget must stay within the 240s Cloud Run cap");

    assert.equal(plain.get("SCHEDULERS_ENABLED"), "false");
    assert.equal(plain.get("SCHEDULER_LEASE_MODE"), "off");
    assert.equal(plain.get("EFORMSIGN_RECONCILE_ALLOW_UNLOCKED"), "false");
    assert.equal(plain.get("APP_PORT"), "3001");
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
    // RUNTIME_ONLY keys are deliberately absent from env.tpl; test 8 asserts
    // each of them individually with its reason.
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
