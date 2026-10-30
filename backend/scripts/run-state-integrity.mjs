import { spawnSync } from "node:child_process";

// State-integrity real-DB runner: same shape as run-full-flow-e2e.mjs, but the
// schema comes from `prisma migrate deploy` (NOT `db push`) because the integrity
// tests assert SQL-only CHECK constraints and partial indexes that only the
// migrations create. The database name contains "throwaway" — the specs' guard
// refuses anything else.
const databaseName = "bjj_state_integrity_throwaway";
const pgUser = process.env.PGUSER || "postgres";
const databaseUrl = `postgresql://${pgUser}@localhost:5432/${databaseName}`;
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
    run("dropdb", ["--host", "localhost", "--username", pgUser, "--if-exists", databaseName]);
}

try {
    dropDatabase();
    run("createdb", ["--host", "localhost", "--username", pgUser, databaseName]);
    run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
    // Extra CLI args are forwarded to jest and REPLACE the default path filter
    // (jest ORs positional patterns, so appending would widen instead of narrow):
    // `node scripts/run-state-integrity.mjs test/integrity/clients` runs one area.
    // jest's array options greedily consume following positionals, so the user
    // args come first and --testPathIgnorePatterns stays last.
    const jestArgs = process.argv.slice(2);
    const patternArgs = jestArgs.length > 0 ? jestArgs : ["test/integrity"];
    run("pnpm", [
        "exec",
        "jest",
        ...patternArgs,
        "--runInBand",
        "--testPathIgnorePatterns=/node_modules/",
    ]);
} finally {
    dropDatabase();
}
