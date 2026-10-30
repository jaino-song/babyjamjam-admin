import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// State-integrity real-DB runner: same shape as run-full-flow-e2e.mjs, but the
// schema comes from `prisma migrate deploy` (NOT `db push`) because the integrity
// tests assert SQL-only CHECK constraints and partial indexes that only the
// migrations create. The database name contains "throwaway" — the specs' guard
// refuses anything else.
const databaseName = "bjj_state_integrity_throwaway";
const pgUser = process.env.PGUSER || "postgres";
const pgPort = process.env.PGPORT || "5432";
const databaseUrl = `postgresql://${pgUser}@localhost:${pgPort}/${databaseName}`;
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_VENDOR_STUBS: "1",
    STATE_INTEGRITY_REAL_DB: "1",
};

function run(command, args) {
    const result = spawnSync(command, args, { env, stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

function dropDatabase() {
    run("dropdb", ["--host", "localhost", "--port", pgPort, "--username", pgUser, "--if-exists", databaseName]);
}

try {
    dropDatabase();
    run("createdb", ["--host", "localhost", "--port", pgPort, "--username", pgUser, databaseName]);
    run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
    // Extra CLI args are forwarded to jest. A positional path argument the user
    // passes (e.g. `node scripts/run-state-integrity.mjs test/integrity/clients`)
    // narrows the default scope, so it is used as-is; otherwise `test/integrity`
    // is appended so that flag-only invocations (e.g. `-t harness`) still run
    // ONLY the integrity suites and never the wider unit/e2e suites. A
    // positional is detected as a non-flag argument that exists on disk — the
    // VALUE of a flag like `-t harness` is not a path, so it must not suppress
    // the default path. The path goes last because jest's array options
    // greedily consume positionals. The jest config's own ignore list
    // (node_modules, dist, e2e) stays in charge — this runner must not replace
    // or override it.
    const userArgs = process.argv.slice(2);
    const forwardsPositionalPath = userArgs.some((arg) => !arg.startsWith("-") && existsSync(arg));
    const patternArgs = forwardsPositionalPath ? userArgs : [...userArgs, "test/integrity"];
    run("pnpm", ["exec", "jest", ...patternArgs, "--runInBand"]);
} finally {
    // A drop failure here must not mask the primary failure above (e.g. a red
    // jest run): log it and let the original error decide the exit code.
    try {
        dropDatabase();
    } catch (dropError) {
        console.error(`[run-state-integrity] dropdb ${databaseName} failed:`, dropError.message);
    }
}
