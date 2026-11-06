import { constants, promises as fs, readFileSync, lstatSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync, fork } from "node:child_process";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createConnection } from "node:net";

const entry = fileURLToPath(import.meta.url);
const backend = path.resolve(path.dirname(entry), "..");
const worktree = path.dirname(backend);
const require = createRequire(path.join(backend, "package.json"));
export const TARGET = Object.freeze({
    connection: "/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/private-ui-postgres-synced/connection.json",
    password: "/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/private-test-postgres/password",
    ownership: "/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/private-ui-postgres-synced/ownership.json",
    root: "/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/qa-fixture-synced-runtime",
    qaEnv: "/Users/jaino/Development/babyjamjam-admin/eformsign-backup-ui-connection/frontend/.env.local",
    database: "backup_exec_throwaway_ui_synced_20261107", host: "127.0.0.1", port: 63241, user: "backup_test_owner",
});
const OWNED = ["scripts/eformsign-backup-qa.mjs", "test/qa/eformsign-backup-fixture-app.ts", "test/qa/eformsign-backup-fixture-data.ts", "test/qa/eformsign-backup-fixture-worker.ts", "test/scripts/eformsign-backup-qa.spec.ts", "test/qa/eformsign-backup-fixture-app.spec.ts"];
export const NATIVE_OWNED_PATHS = Object.freeze([
    "backend/application/services/eformsign-manual-backup.service.ts",
    "backend/interface/controllers/eformsign-manual-backup-worker.controller.ts",
    "backend/interface/controllers/eformsign-manual-backup.controller.ts",
    "backend/interface/filters/eformsign-manual-backup.filter.ts",
    "backend/module/eformsign-backup-export.module.ts",
    "backend/test/application/eformsign-manual-backup-staff-expiry.spec.ts",
    "backend/test/integration/eformsign-manual-backup-http.spec.ts",
    "backend/test/qa/eformsign-backup-fixture-app.spec.ts",
    "backend/test/qa/eformsign-backup-fixture-app.ts",
    "backend/test/qa/eformsign-backup-fixture-worker.ts",
    "frontend/src/app/(protected)/contracts/page.tsx",
    "frontend/src/app/api/eformsign-backups/runs/[runId]/documents/route.ts",
    "frontend/src/app/api/eformsign-backups/runs/[runId]/route.ts",
    "frontend/src/app/api/eformsign-backups/runs/__tests__/route.test.ts",
    "frontend/src/app/api/eformsign-backups/runs/route.ts",
    "frontend/src/components/app/contracts/ContractBackupManager.tsx",
    "frontend/src/components/app/contracts/__tests__/ConnectedContractBackupManager.test.tsx",
    "frontend/src/hooks/__tests__/useEformsignBackups.test.tsx",
    "frontend/src/hooks/useEformsignBackups.ts",
    "frontend/src/lib/__tests__/eformsign-backup-api.test.ts",
    "frontend/src/lib/eformsign-backup-api.ts",
    "frontend/src/lib/eformsign-backup-view.ts",
    "frontend/src/services/eformsign-backups.ts",
    "scripts/__tests__/eformsign-backup-ui-qa.test.mjs",
    "scripts/eformsign-backup-ui-qa.mjs",
    "backend/scripts/eformsign-backup-qa.mjs",
    "backend/test/scripts/eformsign-backup-qa.spec.ts"
]);
export const TABLE_INVENTORY = Object.freeze([
    "admin_audit_event",
    "agent_action",
    "agent_feedback",
    "agent_message",
    "agent_session",
    "agent_task",
    "agent_task_event",
    "agent_trace",
    "area",
    "auth_email_outbox",
    "auth_flow_state",
    "auth_rate_limit",
    "auth_refresh_token",
    "auth_session",
    "auth_token",
    "bank_account_info",
    "branch",
    "branch_holiday_override",
    "call_ingest_token",
    "call_record",
    "chat_feedback",
    "chat_message",
    "chat_session",
    "client",
    "client_draft",
    "consultation_inquiry",
    "doc_template",
    "document",
    "document_category",
    "eformsign_backup_collection_page",
    "eformsign_backup_collection_run",
    "eformsign_backup_export_candidate",
    "eformsign_backup_export_credential",
    "eformsign_backup_export_snapshot",
    "eformsign_backup_run",
    "eformsign_backup_run_document",
    "eformsign_dispatch_intent",
    "eformsign_doc",
    "eformsign_doc_file",
    "eformsign_document_job",
    "eformsign_webhook_event",
    "employee",
    "employee_schedule",
    "end_date_review_item",
    "holiday_calendar_revision",
    "holiday_change_event",
    "holiday_year_snapshot",
    "legacy_chat_confirmation_intent",
    "message",
    "message_log",
    "message_template",
    "message_trigger_job",
    "message_trigger_rule",
    "message_trigger_rule_branch_override",
    "message_trigger_rule_group",
    "notification",
    "out_of_pocket_price_info",
    "public_holiday",
    "push_subscription",
    "receipt_link_token",
    "schedule_change_request",
    "scheduler_lease",
    "service_record",
    "service_record_assignment",
    "service_record_case",
    "service_record_day",
    "service_record_day_edit_log",
    "service_record_edit_draft",
    "service_record_revision",
    "service_record_revision_document_state",
    "service_record_snapshot_chunk",
    "service_record_token",
    "system_setting",
    "system_template",
    "system_template_version",
    "user",
    "user_branch",
    "voucher_price_info",
    "voucher_price_info_2025"
]);
const schemaSource = "prisma/schema.prisma";
const migrationSource = "prisma/migrations/20261106020000_add_manual_eformsign_backup_runs/migration.sql";
const verificationSource = "prisma/scripts/verify-manual-eformsign-backup-runs.sql";
// Immutable policy artifacts at ea7513ab. Expected classifications are literal
// fixture data; these hashes bind the unchanged policy, never compute an oracle.
export const POLICY_ARTIFACTS = Object.freeze({
    "domain/eformsign-backup/export/classification.ts": "c6ea703f3bc49adcdffbc1c080af66a8c1d5b989dce3fd40c7d4741ba6e59f1c",
    "domain/eformsign-backup/export/constants.ts": "c7658df38af40f7ecbeb4c94fc4d3bdf52ecd4e03a6559257aaa2f38c7fa80bd",
    "domain/constants/eformsign-doc-status.constants.ts": "08cbef806877dcb250dd0adcac5202810952682d616d1c66e46194e9a9c134bf",
    "domain/utils/eformsign-status-code.ts": "bb72a75905e9decf1e3e4ef965a9e410d13eac3ff518ebb0d1c797eb1af7b8aa",
});
export const NATIVE_PHASE_STAGES = Object.freeze(["routeprobe", "consumer-init", "manual-negative", "manual-stale", "basic", "pagination", "kst", "cleanup"]);
export const NATIVE_PHASE_STEPS = Object.freeze(["routeprobe", "consumer-init", "manual-negative", "manual-stale", "post", "idempotency", "selectB", "crossbranchread", "restoreA", "capture", "consume", "readresults", "artifactcheck", "cleanup"]);
export const NATIVE_PHASE_FAILURES = Object.freeze([
    "CLAIM_LIMIT",
    "EXERCISE_TIMEOUT",
    "FOREIGN_BRANCH",
    "FOREIGN_CANDIDATE",
    "FOREIGN_COUNTER",
    "FOREIGN_CREDENTIAL",
    "FOREIGN_DOCUMENT",
    "FOREIGN_FILE",
    "FOREIGN_MEMBERSHIP",
    "FOREIGN_REFRESH",
    "FOREIGN_RESULT",
    "FOREIGN_ROWS",
    "FOREIGN_RUN",
    "FOREIGN_SESSION",
    "FOREIGN_SNAPSHOT",
    "FOREIGN_USER",
    "LOCAL_ARTIFACT_ORACLE",
    "MANUAL_ERROR_ORACLE",
    "MANUAL_RENEWED_ORACLE",
    "MANUAL_STALE_ORACLE",
    "METADATA_ONLY_LOCAL_ORACLE",
    "NATIVE_PAGINATION_REQUIRED",
    "PRODUCT_BRANCH_ORACLE",
    "PRODUCT_COVERAGE_ORACLE",
    "PRODUCT_DOCUMENTS_FAILED",
    "PRODUCT_DRIVE_ORACLE",
    "PRODUCT_GET_FAILED",
    "PRODUCT_IDEMPOTENCY_ORACLE",
    "PRODUCT_OBSERVATION_ORACLE",
    "PRODUCT_PAGINATION_ORACLE",
    "PRODUCT_PHASE_UNKNOWN",
    "PRODUCT_POST_FAILED",
    "PRODUCT_ROUTES_UNAVAILABLE",
    "PRODUCT_SELECTION_ORACLE",
    "PRODUCT_SUMMARY_ORACLE",
    "PROFILE_NOT_SEEDED",
    "PUBLIC_DOCUMENT_FIELDS_ORACLE",
    "PUBLIC_RUN_FIELDS_ORACLE",
    "SESSION_LIMIT"
]);
export function safeNativePhase(message) {
    return {
        phaseStage: NATIVE_PHASE_STAGES.includes(message?.phaseStage) ? message.phaseStage : "routeprobe",
        phaseStep: NATIVE_PHASE_STEPS.includes(message?.phaseStep) ? message.phaseStep : "routeprobe",
        phaseFailure: NATIVE_PHASE_FAILURES.includes(message?.phaseFailure) ? message.phaseFailure : "NATIVE_PHASE_FAILED",
    };
}
const markerFile = path.join(TARGET.root, "owner.json");
const lockFile = path.join(TARGET.root, "operation.json");
const processFile = path.join(TARGET.root, "process.json");
const capFile = path.join(TARGET.root, "capability");
const pgDump = "/opt/homebrew/opt/postgresql@17/bin/pg_dump";
function demand(value, code = "QA_INPUT_REFUSED") { if (!value) throw new Error(code); }
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = value => process.stdout.write(JSON.stringify(value) + "\n");

// This transport is confined to the explicitly entered native Node process. It is
// a CommonJS package-cache alias, not OS isolation or a public Prisma API.
const evidence = path.dirname(TARGET.root);
const probeRoot = path.join(evidence, "qa-client-probes");
const historyRoot = path.join(evidence, "qa-client-history");
const syntheticUrl = "postgresql://fixture:fixture@127.0.0.1:1/fixture?connection_limit=5";
const clientPolicy = "private-client-v8-absence-or-null";
const runtimePreamble = "\n/* !!! This is code generated by Prisma. Do not edit directly. !!!\n/* eslint-disable */\n// biome-ignore-all lint: generated file\n";
const engineCommit = "c2990dca591cba766e3b7ef5d9e8a84796e47ab7";
export const environmentSnapshot = () => ({ ...process.env });
export function assertEnvironment(snapshot) {
    demand(JSON.stringify(Object.entries(process.env).sort()) === JSON.stringify(Object.entries(snapshot).sort()), "ENVIRONMENT_CHANGED");
}
export function deriveGenerationSchema(source, node, generator) {
    const prefix = 'generator client {\n  provider = "prisma-client-js"\n}\n';
    demand(source.startsWith(prefix) && (source.match(/^generator client\s*\{/gm) ?? []).length === 1, "GENERATOR_LAYOUT_UNSUPPORTED");
    demand([node, generator].every(value => path.isAbsolute(value) && /^[A-Za-z0-9_@./+:-]+$/.test(value)), "GENERATOR_COMMAND_UNSAFE");
    return `generator client {\n  provider = ${JSON.stringify(node + " " + generator)}\n  output = "../generated"\n}\n` + source.slice(prefix.length);
}
export function inspectEnvMetadata(source) {
    // Static closed grammar only: never evaluate generated JS to inspect its config.
    // Count declarations separately so an invalid second container cannot be hidden.
    const declarations = [...source.matchAll(/"relativeEnvPaths"\s*:/g)];
    demand(declarations.length === 1, "GENERATED_ENV_METADATA_REFUSED");
    const declaration = declarations[0];
    const block = /^\s*\{([^{}]*)\}(?=\s*(?:[,}]|$))/.exec(source.slice(declaration.index + declaration[0].length));
    demand(block, "GENERATED_ENV_METADATA_REFUSED");
    const member = '"(?:rootEnvPath|schemaEnvPath)"\\s*:\\s*null';
    demand(new RegExp(`^\\s*(?:${member}(?:\\s*,\\s*${member})*\\s*)?$`).test(block[1]), "GENERATED_ENV_METADATA_REFUSED");
    const keys = [...block[1].matchAll(/"(rootEnvPath|schemaEnvPath)"\s*:/g)].map(match => match[1]);
    demand(new Set(keys).size === keys.length, "GENERATED_ENV_METADATA_REFUSED");
    // Normalized nulls alone lose generator representation. Bind raw key presence
    // alongside them; the manifest also binds the unmodified index.js file hash.
    return {
        rootEnvPath: null, schemaEnvPath: null,
        ownKeys: { rootEnvPath: keys.includes("rootEnvPath"), schemaEnvPath: keys.includes("schemaEnvPath") },
    };
}
export function schemaTokens(source) {
    // The installed CLI aligns whitespace and moves @@unique before @@index.
    // Compare all tokens exactly (including quoted defaults and comments), allowing
    // only the ordering of contiguous, single-line block attributes to differ.
    const tokenize = value => (value.match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s]/g) ?? []).filter(token => !/^\s+$/.test(token));
    const canonical = source.replace(/^(?:[ \t]*@@[^\r\n]*(?:\r?\n|$))+/gm, group =>
        group.trim().split(/\r?\n/).map(line => JSON.stringify(tokenize(line))).sort().join("\n") + "\n");
    return tokenize(canonical);
}
async function sourceFile(file) {
    // Installed pnpm symlinks are resolved statically before this check. No JS is evaluated.
    await physical(file, "file", false);
    return { path: file, sha256: hash(await fs.readFile(file)) };
}
async function inventory(directory, secure = false) {
    const files = {};
    async function walk(dir) {
        await physical(dir, "directory", !secure);
        if (secure) await fs.chmod(dir, 0o700);
        for (const name of (await fs.readdir(dir)).sort()) {
            const file = path.join(dir, name); const stat = await fs.lstat(file);
            demand(stat.uid === process.getuid() && !stat.isSymbolicLink(), "CLIENT_ARTIFACT_OWNER_REFUSED");
            if (stat.isDirectory()) await walk(file);
            else {
                demand(stat.isFile(), "CLIENT_ARTIFACT_TYPE_REFUSED");
                if (secure) await fs.chmod(file, 0o600);
                else await physical(file, "file");
                files[path.relative(directory, file)] = hash(await fs.readFile(file));
            }
        }
    }
    await walk(directory);
    return files;
}
async function runtimeInputs() {
    demand(process.platform === "darwin" && process.arch === "arm64", "LOCAL_PLATFORM_UNSUPPORTED");
    const cli = await fs.realpath(require.resolve("prisma/build/index.js"));
    const generator = await fs.realpath(require.resolve("@prisma/client/generator-build/index.js"));
    const packageFile = await fs.realpath(require.resolve("@prisma/client/package.json"));
    const runtime = path.join(path.dirname(packageFile), "runtime");
    const cliRequire = createRequire(cli);
    const enginesPackage = await fs.realpath(cliRequire.resolve("@prisma/engines/package.json"));
    const engineVersionFile = await fs.realpath(cliRequire.resolve("@prisma/engines-version/package.json"));
    const clientPackage = JSON.parse(await fs.readFile(packageFile, "utf8"));
    const engines = JSON.parse(await fs.readFile(enginesPackage, "utf8"));
    const cliPackage = JSON.parse(await fs.readFile(path.join(path.dirname(cli), "../package.json"), "utf8"));
    demand(clientPackage.version === "6.19.1" && engines.version === "6.19.2" && cliPackage.version === "6.19.2" && JSON.parse(await fs.readFile(engineVersionFile, "utf8")).prisma.enginesVersion === engineCommit, "LOCAL_VERSION_UNEXPECTED");
    const generatorText = await fs.readFile(generator, "utf8");
    // The pinned generator prepends this exact banner when copying JS runtimes.
    demand(generatorText.includes("var generatedCodePreamble = `" + runtimePreamble + "`;") && generatorText.includes("return generatedCodePreamble + fileContent;"), "RUNTIME_COPY_POLICY_UNSUPPORTED");
    const cliText = await fs.readFile(cli, "utf8");
    demand(generatorText.includes("shouldResolvePrismaClient: false") && generatorText.includes('runtimePath: import_node_path8.default.join(__dirname, "..", "runtime")') && cliText.includes("PRISMA_QUERY_ENGINE_LIBRARY") && cliText.includes("PRISMA_SCHEMA_ENGINE_BINARY"), "GENERATOR_POLICY_UNSUPPORTED");
    // Fixed local Prisma cache, pinned to the installed CLI's engine revision.
    // Prevalidate both files and checksum sidecars before the CLI can attempt a fallback.
    const engineDir = `/Users/jaino/.cache/prisma/master/${engineCommit}/darwin-arm64`;
    const engineFiles = {};
    for (const [kind, name, installedName] of [["query", "libquery-engine", "libquery_engine-darwin-arm64.dylib.node"], ["schema", "schema-engine", "schema-engine-darwin-arm64"]]) {
        // The generator copies basename(filePath); the native loader requires the
        // platform filename. Use the installed engine, bound to its cached checksum.
        const file = path.join(path.dirname(enginesPackage), installedName);
        try {
            const identity = await sourceFile(file);
            const cached = await sourceFile(path.join(engineDir, name));
            const sidecar = await sourceFile(cached.path + ".sha256");
            demand((await fs.readFile(sidecar.path, "utf8")).trim() === identity.sha256 && cached.sha256 === identity.sha256, "LOCAL_ENGINE_HASH_MISMATCH");
            engineFiles[kind] = { ...identity, cached, checksum: sidecar };
        } catch (error) { if (error.code === "ENOENT") throw new Error("LOCAL_ENGINE_MISSING"); throw error; }
    }
    const runtimeFiles = {};
    for (const name of (await fs.readdir(runtime)).sort()) {
        const file = path.join(runtime, name);
        const stat = await fs.lstat(file);
        demand(stat.isFile() && !stat.isSymbolicLink(), "RUNTIME_LAYOUT_UNSUPPORTED");
        runtimeFiles[name] = (await sourceFile(file)).sha256;
    }
    return {
        policy: clientPolicy, platform: process.platform, arch: process.arch,
        node: await sourceFile(await fs.realpath(process.execPath)),
        cli: await sourceFile(cli), generator: await sourceFile(generator),
        clientPackage: await sourceFile(packageFile), enginesPackage: await sourceFile(enginesPackage), engineVersionFile: await sourceFile(engineVersionFile),
        versions: { generator: clientPackage.version, runtime: clientPackage.version, cli: cliPackage.version, engines: engines.version, engineCommit, previousGeneratedClient: "6.19.2-not-executed-not-reproduced" },
        runtime: { path: runtime, files: runtimeFiles, copiedLibrarySha256: hash(runtimePreamble + await fs.readFile(path.join(runtime, "library.js"), "utf8")) }, engines: engineFiles,
        lock: await sourceFile(path.join(worktree, "pnpm-lock.yaml")),
    };
}
function artifactPath(file) {
    demand(path.isAbsolute(file) && path.normalize(file) === file && path.basename(file) === "manifest.json", "CLIENT_PATH_REFUSED");
    const directory = path.dirname(file);
    demand(directory === path.join(TARGET.root, "client-runtime") || (path.dirname(directory) === probeRoot && /^probe-[A-Za-z0-9]+$/.test(path.basename(directory))), "CLIENT_PATH_REFUSED");
    return directory;
}
async function privateArtifact(directory) {
    await physical(directory, "directory");
    demand(JSON.stringify((await fs.readdir(directory)).sort()) === JSON.stringify(["generated", "generation", "manifest.json"]), "CLIENT_ROOT_INVENTORY_REFUSED");
    await physical(path.join(directory, "generation"), "directory");
    demand(JSON.stringify(await fs.readdir(path.join(directory, "generation"))) === '["schema.prisma"]', "CLIENT_GENERATION_INVENTORY_REFUSED");
}
export async function validatePrivateManifest(file, digest) {
    const directory = artifactPath(file);
    await privateArtifact(directory);
    const bytes = await privateRead(file);
    demand(/^[a-f0-9]{64}$/.test(digest) && hash(bytes) === digest, "CLIENT_MANIFEST_DIGEST_REFUSED");
    const manifest = JSON.parse(bytes);
    demand(manifest.version === 1 && manifest.policy === clientPolicy && manifest.directory === directory, "CLIENT_MANIFEST_REFUSED");
    const inputs = await runtimeInputs();
    demand(JSON.stringify(manifest.inputs) === JSON.stringify(inputs), "CLIENT_SOURCE_ID_CHANGED");
    const source = await fs.readFile(path.join(backend, schemaSource), "utf8");
    const derived = deriveGenerationSchema(source, inputs.node.path, inputs.generator.path);
    demand(manifest.sourceSchema === hash(source) && manifest.derivedSchema === hash(derived) && hash(await privateRead(path.join(directory, "generation/schema.prisma"))) === hash(derived), "CLIENT_SCHEMA_REFUSED");
    const generated = await inventory(path.join(directory, "generated"));
    demand(JSON.stringify(generated) === JSON.stringify(manifest.generated), "CLIENT_INVENTORY_REFUSED");
    const text = await privateRead(path.join(directory, "generated/index.js"));
    const metadata = inspectEnvMetadata(text);
    demand(JSON.stringify(metadata) === JSON.stringify(manifest.metadata), "CLIENT_METADATA_REFUSED");
    demand(generated["runtime/library.js"] === inputs.runtime.copiedLibrarySha256 && text.includes('require(\'./runtime/library.js\')'), "CLIENT_RUNTIME_NOT_SELF_CONTAINED");
    demand(text.includes('"clientVersion": "6.19.1"') && text.includes(`"engineVersion": "${engineCommit}"`), "CLIENT_VERSION_REFUSED");
    const generatedSchema = await privateRead(path.join(directory, "generated/schema.prisma"));
    demand(JSON.stringify(schemaTokens(generatedSchema)) === JSON.stringify(schemaTokens(derived)), "CLIENT_MODEL_IDENTITY_REFUSED");
    demand(generated["libquery_engine-darwin-arm64.dylib.node"] === inputs.engines.query.sha256, "CLIENT_ENGINE_IDENTITY_REFUSED");
    return manifest;
}
async function generatePrivateClient(directory) {
    await physical(directory, "directory");
    demand((await fs.readdir(directory)).length === 0, "CLIENT_DIRECTORY_NOT_EMPTY");
    const inputs = await runtimeInputs();
    const source = await fs.readFile(path.join(backend, schemaSource), "utf8");
    const derived = deriveGenerationSchema(source, inputs.node.path, inputs.generator.path);
    const generation = path.join(directory, "generation");
    await fs.mkdir(generation, { mode: 0o700 });
    await write(path.join(generation, "schema.prisma"), derived, true);
    await runQuiet(inputs.node.path, [inputs.cli.path, "generate", "--schema", path.join(generation, "schema.prisma")], generation,
        cleanEnv({ DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", PRISMA_QUERY_ENGINE_LIBRARY: inputs.engines.query.path, PRISMA_SCHEMA_ENGINE_BINARY: inputs.engines.schema.path, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" }));
    const generated = await inventory(path.join(directory, "generated"), true);
    const metadata = inspectEnvMetadata(await privateRead(path.join(directory, "generated/index.js")));
    const manifest = { version: 1, policy: clientPolicy, directory, sourceSchema: hash(source), derivedSchema: hash(derived), inputs, generated, metadata };
    const file = path.join(directory, "manifest.json");
    await write(file, manifest, true);
    const digest = hash(await privateRead(file));
    await validatePrivateManifest(file, digest);
    return { path: file, digest };
}
function originalPackage() {
    const original = require.resolve("@prisma/client"); // Resolution only; never evaluate it.
    const packageDirectory = path.dirname(original);
    const resolver = createRequire(original);
    const generated = (resolver.resolve.paths(".prisma/client/default") ?? []).map(base => path.join(base, ".prisma/client"));
    return { original, packageDirectory, generated };
}
export function assertOriginalAbsent(cache, original, packageDirectory, generated) {
    demand(!cache[original], "ORIGINAL_CLIENT_PRELOADED");
    for (const file of Object.keys(cache)) demand(!file.startsWith(packageDirectory + path.sep) && !generated.some(dir => file.startsWith(dir + path.sep)) && !file.includes(`${path.sep}.prisma${path.sep}client${path.sep}`), "ORIGINAL_CLIENT_PRELOADED");
}
export async function installPrivateAlias(file, digest) {
    const pinned = originalPackage();
    assertOriginalAbsent(require.cache, pinned.original, pinned.packageDirectory, pinned.generated);
    const manifest = await validatePrivateManifest(file, digest);
    const snapshot = environmentSnapshot();
    const privateEntry = path.join(manifest.directory, "generated/index.js");
    const exports = require(privateEntry);
    assertEnvironment(snapshot);
    const alias = new Module(pinned.original);
    alias.filename = pinned.original; alias.loaded = true; alias.exports = exports;
    // Exactly one cache entry. No Module._load, resolver, fs, dotenv or NODE_PATH patch.
    require.cache[pinned.original] = alias;
    const audit = () => {
        demand(require.cache[pinned.original] === alias && require("@prisma/client") === exports, "CLIENT_ALIAS_CHANGED");
        for (const [loaded, record] of Object.entries(require.cache)) {
            if (loaded === pinned.original) continue;
            demand(!loaded.startsWith(pinned.packageDirectory + path.sep) && !pinned.generated.some(dir => loaded.startsWith(dir + path.sep)) && !loaded.includes(`${path.sep}.prisma${path.sep}client${path.sep}`), "ORIGINAL_CLIENT_EXECUTED");
            if (loaded.startsWith(manifest.directory + path.sep)) demand(manifest.generated[path.relative(path.join(manifest.directory, "generated"), loaded)] !== undefined, "PRIVATE_MODULE_UNEXPECTED");
            for (const child of record.children ?? []) {
                if (child.filename === pinned.original) demand(child.exports === exports && child.exports.Prisma === exports.Prisma && child.exports.PrismaClient === exports.PrismaClient, "CLIENT_CONTEXT_MISMATCH");
            }
        }
        assertEnvironment(snapshot);
    };
    audit();
    return { exports, audit };
}
async function clientProbe(options) {
    const identity = candidateIdentity(options);
    // No descriptor, password, QA env or database access in this mode.
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, cleanEnv({ DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl }));
    const snapshot = environmentSnapshot();
    await physical(evidence, "directory", false);
    await fs.mkdir(probeRoot, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    await physical(probeRoot, "directory");
    const directory = await fs.mkdtemp(path.join(probeRoot, "probe-"));
    let stage = "generate"; let db;
    try {
        const manifest = await generatePrivateClient(directory);
        assertEnvironment(snapshot); stage = "import";
        const client = await installPrivateAlias(manifest.path, manifest.digest);
        stage = "construct";
        db = new client.exports.PrismaClient({ datasources: { db: { url: syntheticUrl } }, log: [] });
        assertEnvironment(snapshot); client.audit();
        stage = "disconnect"; await db.$disconnect(); db = undefined;
        client.audit(); assertEnvironment(snapshot);
        await validatePrivateManifest(manifest.path, manifest.digest);
        await removeSession(directory);
        report({ code: "CLIENT_PROBE_PASSED", candidate: identity.head, nativeOnly: true, formalReadiness: false, environmentUnchanged: true, generatorRuntime: "6.19.1", cliEngines: "6.19.2", engineCommit, manifestDigest: manifest.digest });
    } catch (error) {
        await db?.$disconnect();
        await write(path.join(directory, "failure.json"), { stage, environmentUnchanged: (() => { try { assertEnvironment(snapshot); return true; } catch { return false; } })(), nativeOnly: true, formalReadiness: false });
        throw error;
    }
}
async function readonlyBaseline(connection, sources) {
    const psql = "/opt/homebrew/opt/postgresql@17/bin/psql";
    const read = async sql => {
        const result = await runQuiet(psql, ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", TARGET.host, "-p", String(TARGET.port), "-U", TARGET.user, "-d", TARGET.database, "-c", sql], TARGET.root,
            cleanEnv({ PGPASSWORD: connection.password, PGOPTIONS: "-c default_transaction_read_only=on" }), 40_000, true);
        return result.stdout.trim();
    };
    demand(await read(`SELECT current_database()='${TARGET.database}' AND current_user='${TARGET.user}' AND host(inet_server_addr())='${TARGET.host}' AND inet_server_port()=${TARGET.port} AND pg_get_userbyid(datdba)=current_user FROM pg_database WHERE datname=current_database()`) === "t", "LIVE_DB_IDENTITY_REFUSED");
    demand(await read("SELECT count(*)=0 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()") === "t", "DATABASE_SESSION_ACTIVE");
    const names = await fs.readdir(TARGET.root);
    demand(!names.some(n => ["process.json", "capability", "session"].includes(n)), "INTERRUPTED_SESSION");
    if (!names.includes("owner.json")) {
        demand(names.length === 1 && names[0] === "operation.json", "INITIAL_ROOT_NOT_EMPTY");
        demand(await read("SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')") === "t", "INITIAL_DATABASE_NOT_EMPTY");
        return;
    }
    const marker = await jsonRead(markerFile);
    validatePreparedMarker(marker, sources);
    demand(names.every(name => ["operation.json", "owner.json", "schema.prisma", "migration.sql", "schema.sql", "client-runtime"].includes(name)), "UNKNOWN_PREPARED_ROOT_ENTRY");
    demand(hash(await privateRead(path.join(TARGET.root, "schema.prisma"))) === sources.schema && hash(await privateRead(path.join(TARGET.root, "migration.sql"))) === sources.migration, "PRIVATE_SOURCE_CHANGED");
    demand(hash(await fingerprint(connection, TARGET.root)) === marker.fingerprint && hash(await privateRead(path.join(TARGET.root, "schema.sql"))) === marker.fingerprint, "FULL_SCHEMA_CHANGED");
    demand(await read("SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND pg_get_userbyid(c.relowner) <> current_user") === "t", "FOREIGN_OBJECT_OWNER");
    demand(await read("SELECT count(*)=0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND pg_get_userbyid(p.proowner) <> current_user") === "t", "FOREIGN_ROUTINE_OWNER");
    const tableNames = (await read("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).split("\n");
    demand(JSON.stringify(tableNames) === JSON.stringify(TABLE_INVENTORY), "TABLE_INVENTORY_CHANGED");
    const counts = await read(tableNames.map(n => `SELECT count(*)=0 FROM public."${n}"`).join(" UNION ALL "));
    demand(counts.split("\n").length === 79 && counts.split("\n").every(value => value === "t"), "BASELINE_NOT_EMPTY");
    report({ code: "CLEAN_BASELINE_VERIFIED", tables: 79, allTablesEmpty: true, schemaAndCopiesMatch: true, ownersMatch: true, otherDatabaseSessions: 0, activeRecordsAbsent: true });
}
async function ensurePrivateClient() {
    const directory = path.join(TARGET.root, "client-runtime");
    try {
        await physical(directory, "directory");
        const file = path.join(directory, "manifest.json");
        const digest = hash(await privateRead(file));
        await validatePrivateManifest(file, digest);
        return { path: file, digest };
    } catch (error) {
        if (error.message === "CLIENT_SOURCE_ID_CHANGED") {
            // Called only with exclusive ownership after readonly proof of a clean baseline.
            // Preserve the prior identity outside the active root; never silently adopt it.
            await privateArtifact(directory);
            await inventory(path.join(directory, "generated"));
            await fs.mkdir(historyRoot, { mode: 0o700 }).catch(failure => { if (failure.code !== "EEXIST") throw failure; });
            await physical(historyRoot, "directory");
            const archive = path.join(historyRoot, `client-${randomUUID()}`);
            await fs.rename(directory, archive);
        } else if (error.code !== "ENOENT" || await fs.lstat(directory).then(() => true, () => false)) throw error;
    }
    await fs.mkdir(directory, { mode: 0o700 });
    return await generatePrivateClient(directory);
}

export function parseArgs(args) {
    const [mode, ...flags] = args;
    demand(["client-probe", "prepare", "self-test", "start", "stop", "readiness", "exercise"].includes(mode));
    const parsed = { mode, profile: "basic", port: 3003 };
    const seen = new Set();
    const names = mode === "client-probe" ? ["--candidate"] : ["--connection-file", "--qa-env-file", "--root", "--candidate", "--profile", "--port"];
    for (let i = 0; i < flags.length; i += 2) {
        const key = flags[i]; const value = flags[i + 1];
        demand(names.includes(key) && !seen.has(key) && typeof value === "string" && value.length > 0 && !/[\x00-\x20\x7f]/.test(value));
        seen.add(key); parsed[key.slice(2)] = value;
    }
    if (mode !== "client-probe") demand(parsed["connection-file"] === TARGET.connection && parsed["qa-env-file"] === TARGET.qaEnv && parsed.root === TARGET.root);
    demand(["basic", "pagination", "kst"].includes(parsed.profile));
    demand(parsed.port === 3003 || parsed.port === "3003"); parsed.port = 3003;
    if (parsed.candidate !== undefined) demand(/^[0-9a-f]{40}$/.test(parsed.candidate));
    return parsed;
}
export function validateDescriptor(value, ownership) {
    demand(value && Object.keys(value).sort().join(",") === "database,host,passwordFile,port,user");
    demand(value.host === TARGET.host && value.port === TARGET.port && value.database === TARGET.database && value.user === TARGET.user && value.passwordFile === TARGET.password);
    demand(ownership && ownership.database === TARGET.database && ownership.host === TARGET.host && ownership.port === TARGET.port && ownership.createdByThisTask === true);
}
export async function physical(target, kind, privateMode = true) {
    demand(path.isAbsolute(target) && path.normalize(target) === target && !target.split(path.sep).includes(".."));
    let current = path.parse(target).root;
    for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const stat = await fs.lstat(current);
        demand(!stat.isSymbolicLink(), "QA_SYMLINK_REFUSED");
    }
    const stat = await fs.lstat(target);
    demand(stat.uid === process.getuid() && (kind === "file" ? stat.isFile() : stat.isDirectory()), "QA_OWNER_REFUSED");
    if (privateMode) demand((stat.mode & 0o777) === (kind === "file" ? 0o600 : 0o700), "QA_MODE_REFUSED");
    return stat;
}
async function privateRead(file) {
    await physical(path.dirname(file), "directory"); await physical(file, "file");
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { demand((await handle.stat()).uid === process.getuid()); return await handle.readFile("utf8"); } finally { await handle.close(); }
}
async function jsonRead(file) { return JSON.parse(await privateRead(file)); }
async function write(file, value, exclusive = false) {
    await fs.writeFile(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value), { mode: 0o600, flag: exclusive ? "wx" : "w" });
}
export function cleanEnv(extra = {}) {
    // No inherited service, PostgreSQL, Node loader, dotenv, cloud or auth overrides.
    return { PATH: "/Users/jaino/.hermes/node/bin:/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", ...extra };
}
function git(args) {
    const result = spawnSync("/usr/bin/git", args, { cwd: worktree, env: cleanEnv(), encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    demand(result.status === 0, "GIT_IDENTITY_FAILED"); return result.stdout.trimEnd();
}
export function validateNativeChanges(records, paths = NATIVE_OWNED_PATHS) {
    demand(records.every(record => typeof record.path === "string" && paths.includes(record.path)
        && [" M", "M ", "MM", "A ", "AM", "??"].includes(record.status)), "FOREIGN_WIP_REFUSED");
}
function nativeSourceDigest(records) {
    validateNativeChanges(records);
    const digest = createHash("sha256");
    for (const record of [...records].sort((a, b) => a.path.localeCompare(b.path))) {
        const file = path.join(worktree, record.path);
        const stat = lstatSync(file);
        demand(stat.isFile() && !stat.isSymbolicLink(), "FOREIGN_WIP_REFUSED");
        digest.update(record.path + "\0" + record.status + "\0");
        digest.update(readFileSync(file)); digest.update("\0");
    }
    return digest.digest("hex");
}
export function candidateIdentity(options) {
    const head = git(["rev-parse", "HEAD"]);
    const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const dirty = status !== "";
    if (options.candidate !== undefined) demand(options.candidate === head, "CANDIDATE_MISMATCH");
    const nativeOnly = ["self-test", "client-probe"].includes(options.mode);
    let sourceDigest;
    if (nativeOnly) {
        const records = status.split("\0").filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }));
        if (options.mode === "self-test") sourceDigest = nativeSourceDigest(records);
        else validateNativeChanges(records, OWNED.map(file => `backend/${file}`));
    }
    if (["start", "readiness", "exercise"].includes(options.mode) || (options.candidate !== undefined && !nativeOnly)) demand(!dirty && options.candidate === head, "CLEAN_CANDIDATE_REQUIRED");
    return { head, dirty, nativeOnly, worktree, ...(sourceDigest ? { nativeSourceDigest: sourceDigest } : {}) };
}
async function sourceIdentity() {
    const schema = await fs.readFile(path.join(backend, schemaSource));
    const migration = await fs.readFile(path.join(backend, migrationSource));
    demand(hash(schema) === hash(git(["show", `HEAD:backend/${schemaSource}`]) + "\n"), "SCHEMA_NOT_COMMITTED");
    demand(hash(migration) === hash(git(["show", `HEAD:backend/${migrationSource}`]) + "\n"), "MIGRATION_NOT_COMMITTED");
    const helpers = {};
    for (const file of OWNED) helpers[file] = hash(await fs.readFile(path.join(backend, file)));
    const verification = await fs.readFile(path.join(backend, verificationSource));
    demand(hash(verification) === hash(git(["show", `HEAD:backend/${verificationSource}`]) + "\n"), "VERIFIER_NOT_COMMITTED");
    for (const [file, expected] of Object.entries(POLICY_ARTIFACTS)) {
        const bytes = await fs.readFile(path.join(backend, file));
        demand(hash(bytes) === expected && hash(git(["show", `HEAD:backend/${file}`]) + "\n") === expected, "FROZEN_POLICY_CHANGED");
    }
    return { schema: hash(schema), migration: hash(migration), verification: hash(verification), helpers, policy: POLICY_ARTIFACTS };
}
async function connectionDescriptor() {
    const descriptor = await jsonRead(TARGET.connection);
    const ownership = await jsonRead(TARGET.ownership);
    validateDescriptor(descriptor, ownership);
    const password = (await privateRead(TARGET.password)).trim();
    demand(password && !/[\r\n\0]/.test(password));
    const url = new URL(`postgresql://${TARGET.host}:${TARGET.port}/${TARGET.database}`);
    url.username = TARGET.user; url.password = password; url.searchParams.set("connection_limit", "5");
    return { url: url.href, password };
}
async function targetConnection(connection, manifest) {
    const { exports: client, audit } = await installPrivateAlias(manifest.path, manifest.digest);
    const snapshot = environmentSnapshot();
    const db = new client.PrismaClient({ datasources: { db: { url: connection.url } }, log: [] });
    assertEnvironment(snapshot); audit();
    try {
        const rows = await db.$queryRawUnsafe("SELECT current_database() AS db,current_user AS usr,host(inet_server_addr()) AS addr,inet_server_port() AS port,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()");
        demand(rows.length === 1 && rows[0].db === TARGET.database && rows[0].usr === TARGET.user && rows[0].owner === TARGET.user && rows[0].addr === TARGET.host && rows[0].port === TARGET.port, "LIVE_DB_IDENTITY_REFUSED");
        return { ...connection, db };
    } catch (error) { await db.$disconnect(); throw error; }
}

async function qaCredentials() {
    await physical(path.dirname(TARGET.qaEnv), "directory", false);
    await physical(TARGET.qaEnv, "file");
    // dotenv semantics, but never pass any other key into the fixture environment.
    // dotenv is a declared @nestjs/config dependency in this frozen workspace, not a backend direct dependency.
    const { parse } = createRequire(require.resolve("@nestjs/config/package.json"))("dotenv");
    const env = parse(await fs.readFile(TARGET.qaEnv));
    const email = env.LOCAL_AUTO_LOGIN_EMAIL; const password = env.LOCAL_AUTO_LOGIN_PASSWORD;
    demand(typeof email === "string" && email.length > 0 && email === email.toLowerCase() && typeof password === "string" && password.length > 0, "QA_CREDENTIALS_MISSING");
    return { email, password };
}
async function emptyDatabase(db, schemaAbsent = false) {
    const objects = await db.$queryRawUnsafe("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')");
    if (schemaAbsent) {
        demand(objects.length === 0, "INITIAL_DATABASE_NOT_EMPTY");
        const extra = await db.$queryRawUnsafe("SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') AS n");
        demand(extra[0].n === 0n, "INITIAL_DATABASE_NOT_EMPTY");
        return;
    }
    const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    demand(JSON.stringify(tables.map(t => t.tablename).sort()) === JSON.stringify(TABLE_INVENTORY), "TABLE_INVENTORY_CHANGED");
    for (const { tablename } of tables) {
        const rows = await db.$queryRawUnsafe(`SELECT count(*) AS n FROM public."${tablename.replaceAll('"', '""')}"`);
        demand(rows[0].n === 0n, "BASELINE_NOT_EMPTY");
    }
}
async function objectOwners(db) {
    const bad = await db.$queryRawUnsafe("SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND pg_get_userbyid(c.relowner) <> current_user");
    demand(bad[0].n === 0n, "FOREIGN_OBJECT_OWNER");
    const routines = await db.$queryRawUnsafe("SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND pg_get_userbyid(p.proowner) <> current_user");
    demand(routines[0].n === 0n, "FOREIGN_ROUTINE_OWNER");
}
export function normalizeDump(ddl) {
    // Deliberately no whitespace/DDL normalization. PostgreSQL 17 random \restrict capability and banners only.
    return ddl.replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm, "")
        .replace(/^-- (?:Dumped from database version|Dumped by pg_dump version|Started on|Completed on).*\r?\n/gm, "");
}
async function runQuiet(command, args, cwd, env, timeout = 40_000, capture = false) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
        let bytes = 0;
        const chunks = [];
        child.stdout.on("data", b => { bytes += b.length; if (capture) chunks.push(b); if (bytes > 32 * 1024 * 1024) child.kill("SIGTERM"); }); child.stderr.on("data", b => { bytes += b.length; });
        const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
        const hard = setTimeout(() => child.kill("SIGKILL"), timeout + 5000);
        child.once("error", () => { clearTimeout(timer); clearTimeout(hard); reject(new Error("SUBPROCESS_FAILED")); });
        child.once("exit", (code, signal) => { clearTimeout(timer); clearTimeout(hard); if (code === 0 && !signal && bytes <= 32 * 1024 * 1024) resolve({ exit: code, discardedBytes: bytes, stdout: capture ? Buffer.concat(chunks).toString("utf8") : undefined }); else reject(new Error("SUBPROCESS_FAILED")); });
    });
}
async function fingerprint(connection, cwd) {
    const result = await runQuiet(pgDump, ["--schema-only", "--no-owner", "--no-comments", "--host", TARGET.host, "--port", String(TARGET.port), "--username", TARGET.user, "--dbname", TARGET.database], cwd, cleanEnv({ PGPASSWORD: connection.password }), 40_000, true);
    return normalizeDump(result.stdout);
}
async function validateRoot() {
    await physical(TARGET.root, "directory");
    const entries = await fs.readdir(TARGET.root);
    demand(entries.every(name => ["owner.json", "operation.json", "process.json", "capability", "schema.prisma", "migration.sql", "schema.sql", "session", "client-runtime"].includes(name)), "UNKNOWN_ROOT_FILE");
    for (const name of entries) await physical(path.join(TARGET.root, name), ["session", "client-runtime"].includes(name) ? "directory" : "file");
}
async function acquire() {
    const lock = { nonce: randomUUID(), pid: process.pid, uid: process.getuid() };
    try { await write(lockFile, lock, true); } catch { throw new Error("EXCLUSIVE_OWNER_ACTIVE_OR_INTERRUPTED"); }
    return async () => { const current = await jsonRead(lockFile); demand(current.nonce === lock.nonce, "OWNER_CHANGED"); await fs.unlink(lockFile); };
}
export function validatePreparedMarker(marker, sources) {
    demand(marker?.version === 5 && marker.phase === "prepared" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(marker.ownerNonce) && Array.isArray(marker.history), "INTERRUPTED_OR_UNKNOWN_PREPARATION");
    demand(marker.sources?.schema === sources.schema && marker.sources.migration === sources.migration && marker.sources.verification === sources.verification && /^[0-9a-f]{64}$/.test(marker.fingerprint), "SCHEMA_SOURCE_CHANGED");
}
async function prepare(connection, identity, sources) {
    const names = await fs.readdir(TARGET.root);
    if (!names.includes("owner.json")) {
        demand(names.length === 2 && names.includes("operation.json") && names.includes("client-runtime"), "INITIAL_ROOT_NOT_EMPTY");
        await emptyDatabase(connection.db, true);
        const marker = { version: 5, ownerNonce: randomUUID(), phase: "preparing", sources, history: [], candidate: identity };
        await write(markerFile, marker, true);
        // Byte-identical committed files; CLI uses private cwd so it cannot discover backend/.env.
        await write(path.join(TARGET.root, "schema.prisma"), await fs.readFile(path.join(backend, schemaSource)), true);
        await write(path.join(TARGET.root, "migration.sql"), await fs.readFile(path.join(backend, migrationSource)), true);
        const env = cleanEnv({ DATABASE_URL: connection.url, DIRECT_URL: connection.url });
        const prisma = require.resolve("prisma/build/index.js");
        await runQuiet(process.execPath, [prisma, "db", "push", "--skip-generate", "--schema", path.join(TARGET.root, "schema.prisma")], TARGET.root, env);
        marker.phase = "schema-pushed"; await write(markerFile, marker);
        await runQuiet(process.execPath, [prisma, "db", "execute", "--file", path.join(TARGET.root, "migration.sql"), "--schema", path.join(TARGET.root, "schema.prisma")], TARGET.root, env);
        await runQuiet(process.execPath, [prisma, "db", "execute", "--file", path.join(backend, verificationSource), "--schema", path.join(TARGET.root, "schema.prisma")], TARGET.root, env);
        await objectOwners(connection.db);
        await emptyDatabase(connection.db);
        const ddl = await fingerprint(connection, TARGET.root);
        await write(path.join(TARGET.root, "schema.sql"), ddl, true);
        marker.fingerprint = hash(ddl); marker.phase = "prepared"; await write(markerFile, marker);
        return marker;
    }
    const marker = await jsonRead(markerFile);
    validatePreparedMarker(marker, sources);
    demand(hash(await privateRead(path.join(TARGET.root, "schema.prisma"))) === sources.schema && hash(await privateRead(path.join(TARGET.root, "migration.sql"))) === sources.migration, "PRIVATE_SOURCE_CHANGED");
    await objectOwners(connection.db);
    const ddl = await fingerprint(connection, TARGET.root);
    demand(hash(ddl) === marker.fingerprint && hash(await privateRead(path.join(TARGET.root, "schema.sql"))) === marker.fingerprint, "FULL_SCHEMA_CHANGED");
    await emptyDatabase(connection.db);
    demand(!(await fs.readdir(TARGET.root)).some(n => ["session", "process.json", "capability"].includes(n)), "INTERRUPTED_SESSION");
    if (JSON.stringify(marker.sources.helpers) !== JSON.stringify(sources.helpers)) {
        demand(identity.nativeOnly, "HELPER_REVIEW_REQUIRED");
        marker.history.push({ candidate: marker.candidate, helpers: marker.sources.helpers, policy: marker.sources.policy, reason: "native-wip-clean-transition" });
        marker.sources.helpers = sources.helpers;
    }
    if (JSON.stringify(marker.sources.policy) !== JSON.stringify(sources.policy)) {
        demand(identity.nativeOnly, "HELPER_REVIEW_REQUIRED");
        marker.sources.policy = sources.policy;
    }
    marker.candidate = identity;
    await write(markerFile, marker);
    return marker;
}
function processProof(pid) {
    demand(Number.isSafeInteger(pid) && pid > 1);
    const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "uid=,lstart=,command="], { env: cleanEnv(), encoding: "utf8", timeout: 5000 });
    demand(result.status === 0 && result.stdout.trim(), "PROCESS_MISSING");
    const cwd = spawnSync("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { env: cleanEnv(), encoding: "utf8", timeout: 5000 });
    demand(cwd.status === 0, "PROCESS_CWD_UNPROVEN");
    return { identity: result.stdout.trim(), cwd: cwd.stdout.split("\n").find(line => line.startsWith("n"))?.slice(1) };
}
export function verifyProcess(record, actualParent, actualChild) {
    demand(record.uid === process.getuid() && record.entry === entry && record.root === TARGET.root && record.worktree === worktree, "PROCESS_RECORD_REFUSED");
    demand(actualParent.identity === record.parentProof.identity && actualParent.cwd === record.parentProof.cwd && actualChild.identity === record.childProof.identity && actualChild.cwd === record.childProof.cwd, "PROCESS_PROOF_CHANGED");
    const parentEntry = actualParent.identity.includes(entry) || (actualParent.cwd === worktree && actualParent.identity.split(/\s+/).includes("backend/scripts/eformsign-backup-qa.mjs"));
    demand(actualParent.identity.split(/\s+/)[0] === String(record.uid) && actualChild.identity.split(/\s+/)[0] === String(record.uid) && parentEntry && actualChild.identity.includes(path.join(backend, "test/qa/eformsign-backup-fixture-app.ts")) && actualChild.cwd === path.join(TARGET.root, "session"), "PROCESS_ENTRY_REFUSED");
}
async function listening(port) {
    return await new Promise(resolve => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(500);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => { socket.destroy(); resolve(false); });
        socket.once("timeout", () => { socket.destroy(); resolve(true); });
    });
}
async function control(options, identity, sources) {
    const record = await jsonRead(processFile);
    const operation = await jsonRead(lockFile); const marker = await jsonRead(markerFile);
    demand(record.phase === "active" && operation.pid === record.pid && operation.uid === record.uid && marker.ownerNonce === record.ownerNonce, "ACTIVE_OWNER_CHANGED");
    verifyProcess(record, processProof(record.pid), processProof(record.childPid));
    demand(record.candidate.head === identity.head && JSON.stringify(record.sources) === JSON.stringify(sources), "ACTIVE_CANDIDATE_CHANGED");
    const capability = await privateRead(capFile);
    const response = await fetch(`http://127.0.0.1:${record.port}/__qa__/control`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(options.mode === "exercise" ? 120_000 : 10_000),
        headers: { "X-QA-Capability": capability, "X-QA-Nonce": record.nonce, "X-QA-Action": options.mode, "X-QA-Profile": options.profile },
    });
    const result = await response.json();
    demand(response.status === 200 && result.nonce === record.nonce, "HTTP_OWNER_PROOF_FAILED");
    if (options.mode === "stop") {
        const deadline = performance.now() + 30_000;
        while (performance.now() < deadline) {
            try { await fs.lstat(processFile); } catch {
                demand(!(await listening(record.port)), "LISTENER_REMAINS");
                report({ code: "STOPPED", backendOnly: true }); return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("STOP_INCOMPLETE_EVIDENCE_RETAINED");
    }
    // Fixed allowlist: never relay a raw response body from the application.
    if (options.mode === "exercise") {
        if (result.code === "PRODUCT_ROUTES_UNAVAILABLE" && result.success === false) { report({ success: false, code: "PRODUCT_ROUTES_UNAVAILABLE", backendOnly: true }); process.exitCode = 2; return; }
        demand(result.success === true && Number.isSafeInteger(result.selected) && Number.isSafeInteger(result.saved) && Number.isSafeInteger(result.metadataOnly));
        report({ success: true, selected: result.selected, saved: result.saved, metadataOnly: result.metadataOnly, nativeOnly: true, backendOnly: true, killedWorkerRecovery: "unproven" }); return;
    }
    demand(result.ready === true && result.pid === record.childPid && result.nativeOnly === false, "READINESS_UNPROVEN");
    report({ ready: true, backendOnly: true, candidate: identity.head, productRoutes: result.productRoutes === true, productionBuild: false, developmentSourceIdentity: true });
}
async function removeSession(session) {
    async function walk(directory) {
        await physical(directory, "directory");
        for (const name of await fs.readdir(directory)) {
            const file = path.join(directory, name); const stat = await fs.lstat(file);
            demand(!stat.isSymbolicLink() && stat.uid === process.getuid(), "FOREIGN_RUNTIME_FILE");
            if (stat.isDirectory()) await walk(file);
            else { demand(stat.isFile() && (stat.mode & 0o077) === 0, "FOREIGN_RUNTIME_MODE"); await fs.unlink(file); }
        }
        await fs.rmdir(directory);
    }
    await walk(session);
}
export function safeChildSend(child, message) {
    if (child.listenerCount("error") === 0) child.on("error", () => undefined);
    if (child.connected) child.send(message, () => undefined);
}
async function runSession(options, connection, identity, sources, marker) {
    if (options.mode === "start") demand(!(await listening(options.port)), "PORT_ALREADY_OWNED");
    const owner = await qaCredentials();
    const session = path.join(TARGET.root, "session");
    await fs.mkdir(session, { mode: 0o700 });
    marker.phase = "session"; await write(markerFile, marker);
    const capability = randomBytes(32).toString("hex"); const nonce = randomUUID();
    await write(capFile, capability, true);
    const childEntry = path.join(backend, "test/qa/eformsign-backup-fixture-app.ts");
    const child = fork(childEntry, [], {
        cwd: session, env: cleanEnv({ NODE_PATH: backend, TS_NODE_PROJECT: path.join(backend, "tsconfig.json") }),
        execArgv: ["-r", require.resolve("ts-node/register")], stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let discardedBytes = 0; let cleanClosed = false; let ready; let phaseFailure;
    child.stdout.on("data", b => { discardedBytes += b.length; }); child.stderr.on("data", b => { discardedBytes += b.length; });
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    // Child exit can race an IPC send even while connected is still true. Always handle its callback/error event.
    child.on("error", () => undefined);
    const stop = () => safeChildSend(child, "stop");
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    const ttl = setTimeout(stop, 30 * 60_000);
    child.on("message", message => {
        if (message?.stage === "machine-source-proof") report({ code: "MACHINE_SOURCE_PROOF", ready: message.ready === true, failed: message.failed === true,
            companyMatches: message.companyMatches === true, totalMatches: message.totalMatches === true, includedMatches: message.includedMatches === true,
            excludedMatches: message.excludedMatches === true, policyPendingMatches: message.policyPendingMatches === true, otherClassesZero: message.otherClassesZero === true });
        if (message?.stage === "rate-limit-proof") report({
            code: "RATE_LIMIT_FAILURE_PROOF",
            status: Number.isInteger(message.status) && message.status >= 100 && message.status <= 599 ? message.status : null,
            failureContract: message.failureContract === true,
            header: ["identity5", "ip100", "absent", "unknown"].includes(message.header) ? message.header : "unknown",
            normalCredentialRejection: message.normalCredentialRejection === true,
            identityCounterOne: message.identityCounterOne === true,
        });
        if (message?.failureStage === "phase" && ["failed", "failed-clean"].includes(message.stage)) {
            phaseFailure = safeNativePhase(message);
            report({ code: "NATIVE_PHASE_FAILURE", ...phaseFailure, cleanupComplete: message.cleanupComplete === true, retained: message.cleanupComplete !== true,
                workerOperation: ["claim", "renew", "candidates", "validate", "artifact", "document-results", "finish"].includes(message.workerHttp?.operation) ? message.workerHttp.operation : "none",
                workerStatus: Number.isInteger(message.workerHttp?.status) && message.workerHttp.status >= 100 && message.workerHttp.status <= 599 ? message.workerHttp.status : null,
                workerResponseInvalid: message.workerResponseInvalid === true, workerExportUnavailable: message.workerExportUnavailable === true,
                workerControlUnavailable: message.workerControlUnavailable === true, workerLedgerInconsistent: message.workerLedgerInconsistent === true,
                workerLockNotHeld: message.workerLockNotHeld === true });
        }
        if (message?.stage === "closed" || (message?.stage === "failed-clean" && message.cleanupComplete === true)) cleanClosed = true;
        if (message?.stage === "stopping") stop();
    });
    const startingRecord = { pid: process.pid, childPid: child.pid, uid: process.getuid(), entry, root: TARGET.root, worktree, ownerNonce: marker.ownerNonce, nonce, port: null, phase: "starting", candidate: identity, sources };
    try {
        await write(processFile, startingRecord, true);
        safeChildSend(child, { url: connection.url, backend, session, port: options.mode === "self-test" ? 0 : options.port, profile: options.profile, owner, capability, nonce, manifest: marker.client, nativeOnly: options.mode === "self-test" });
        ready = await Promise.race([
            new Promise((resolve, reject) => {
                const timer = setTimeout(() => { stop(); reject(new Error("APP_START_TIMEOUT")); }, 55_000);
                child.on("message", message => {
                    if (message?.stage === "ready") { clearTimeout(timer); resolve(message); }
                    if (message?.stage === "failed" || message?.stage === "failed-clean") {
                        clearTimeout(timer);
                        const stage = ["database", "seed", "compile", "listen", "auth", "source", "phase"].includes(message.failureStage) ? message.failureStage.toUpperCase() : "START";
                        const authCodes = ["LOGIN_FAILURE_CONTRACT_ORACLE", "REAL_LOGIN_FAILED", "REAL_RATE_LIMIT_ORACLE", "OWNER_BRANCH_SELECTION_MISSING", "REAL_BRANCH_SELECTION_FAILED", "REAL_ME_FAILED", "NO_JWT_ORACLE", "UNSELECTED_JWT_ORACLE", "OWNER_ORACLE", "VIEWER_ORACLE", "SPOOF_ORACLE", "SELECT_B_ORACLE"];
                        const sourceCodes = ["MACHINE_GUARD_ORACLE", "MACHINE_COMPANY_ORACLE", "MACHINE_SNAPSHOT_ORACLE", "MACHINE_COUNTS_ORACLE", "MACHINE_PAGE_ORACLE", "FROZEN_EXPORT_ORACLE", "FROZEN_STAGE_ORACLE", "SOURCE_COUNTS_ORACLE", "FROZEN_DATE_ORACLE", "METADATA_ARTIFACT_ORACLE"];
                        reject(new Error(stage === "AUTH" && authCodes.includes(message.authFailure) ? message.authFailure
                            : stage === "SOURCE" && sourceCodes.includes(message.sourceFailure) ? message.sourceFailure
                                : stage === "PHASE" ? safeNativePhase(message).phaseFailure : `APP_${stage}_FAILED`));
                    }
                });
                child.once("exit", () => { clearTimeout(timer); reject(new Error(phaseFailure?.phaseFailure ?? "APP_START_FAILED")); });
            }),
        ]);
        demand(Number.isInteger(ready.port) && ready.port > 0 && ready.port < 65536, "CHILD_PROTOCOL_FAILED");
        const record = { ...startingRecord, port: ready.port, parentProof: processProof(process.pid), childProof: processProof(child.pid) };
        verifyProcess(record, processProof(process.pid), processProof(child.pid));
        await write(processFile, { ...record, phase: "active" });
        if (options.mode === "self-test") stop();
        else report({ code: "STARTED", candidate: identity.head, port: ready.port, backendOnly: true, productRoutes: ready.productRoutes === true, productionBuild: false });
        const result = await exited;
        demand(cleanClosed && result.code === 0 && !result.signal, "CHILD_TEARDOWN_FAILED");
        demand(!(await listening(ready.port)), "LISTENER_REMAINS");
        demand(spawnSync("/bin/ps", ["-p", String(child.pid)], { stdio: "ignore" }).status !== 0, "CHILD_REMAINS");
        await emptyDatabase(connection.db);
        await removeSession(session);
        await fs.unlink(processFile); await fs.unlink(capFile);
        marker.phase = "prepared";
        marker.history.push({ candidate: identity, helpers: sources.helpers, reason: "clean-teardown", nativeOnly: options.mode === "self-test" });
        await write(markerFile, marker);
        await objectOwners(connection.db);
        demand(hash(await fingerprint(connection, TARGET.root)) === marker.fingerprint, "FULL_SCHEMA_CHANGED");
        if (options.mode === "self-test") demand(JSON.stringify(candidateIdentity(options)) === JSON.stringify(identity), "NATIVE_SOURCE_CHANGED");
        report({ code: options.mode === "self-test" ? "NATIVE_SELF_TEST_PASSED" : "CLOSED", exit: result.code, discardedBytes, counts: ready.counts, productRoutes: ready.productRoutes === true, phaseCode: ready.productRoutes ? "PRODUCT_ROUTES_PRESENT" : "PRODUCT_ROUTES_UNAVAILABLE", backendOnly: true, nativeOnly: true, formalReadiness: false, nativeSourceDigest: identity.nativeSourceDigest, killedWorkerRecovery: "unproven" });
    } catch (error) {
        stop();
        const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
        const hard = setTimeout(() => child.kill("SIGKILL"), 15_000);
        await exited; clearTimeout(timer); clearTimeout(hard);
        try { if (cleanClosed) {
            await emptyDatabase(connection.db);
            if (ready?.port) demand(!(await listening(ready.port)), "LISTENER_REMAINS");
            await removeSession(session);
            for (const file of [processFile, capFile]) {
                try { await fs.unlink(file); } catch (failure) { if (failure.code !== "ENOENT") throw failure; }
            }
            marker.phase = "prepared";
            marker.history.push({ candidate: identity, reason: "failed-but-clean-teardown" });
            await write(markerFile, marker);
        }
        } catch {
            report({ code: "NATIVE_CLEANUP_FAILED", ...(phaseFailure ?? {}), cleanupComplete: false, retained: true });
        }
        // Leave phase/session/row evidence in place; never attempt a reset after interruption.
        throw error;
    } finally { clearTimeout(ttl); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
export async function main(args) {
    const options = parseArgs(args);
    if (options.mode === "client-probe") { await clientProbe(options); return; }
    await validateRoot();
    const identity = candidateIdentity(options); const sources = await sourceIdentity();
    const descriptor = await connectionDescriptor();
    // The parent also runs in a dedicated scrubbed native process.
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, cleanEnv({ DATABASE_URL: descriptor.url, DIRECT_URL: descriptor.url, NODE_ENV: "development" }));
    if (["stop", "readiness", "exercise"].includes(options.mode)) {
        const marker = await jsonRead(markerFile);
        demand(marker.version === 5 && marker.phase === "session" && JSON.stringify(marker.sources) === JSON.stringify(sources), "ACTIVE_SOURCE_CHANGED");
        const connection = await targetConnection(descriptor, marker.client);
        try {
            await objectOwners(connection.db);
            demand(hash(await fingerprint(connection, TARGET.root)) === marker.fingerprint, "FULL_SCHEMA_CHANGED");
            await control(options, identity, sources);
        } finally { await connection.db.$disconnect(); }
        return;
    }
    let release; let connection;
    try {
        release = await acquire();
        await readonlyBaseline(descriptor, sources);
        const client = await ensurePrivateClient();
        connection = await targetConnection(descriptor, client);
        const marker = await prepare(connection, identity, sources);
        if (marker.client && marker.client.digest !== client.digest) marker.history.push({ client: marker.client, reason: "private-client-rebuild-clean-baseline" });
        marker.client = client;
        await write(markerFile, marker);
        if (options.mode === "prepare") report({ code: "PREPARED", schemaVerified: true, candidate: identity.head });
        else await runSession(options, connection, identity, sources, marker);
    } finally {
        try { await connection?.db.$disconnect(); } finally {
            if (release) await release();
            if (options.mode === "self-test") demand(JSON.stringify(candidateIdentity(options)) === JSON.stringify(identity), "NATIVE_SOURCE_CHANGED");
        }
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
    main(process.argv.slice(2)).catch(error => {
        const safe = typeof error?.message === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "QA_FAILED_PRIVATE_DETAILS_DISCARDED";
        report({ success: false, code: safe }); process.exitCode = 1;
    });
}
