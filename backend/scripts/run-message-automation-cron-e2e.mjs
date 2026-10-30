import { spawnSync } from "node:child_process";

const databaseName = "bjj_message_cron_e2e";
const databaseUrl = `postgresql://postgres@localhost:5432/${databaseName}`;
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_VENDOR_STUBS: "1",
    E2E_SMS_SAFEGUARD_TOMBSTONE: "1",
    EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID: "tpl-test",
    // Pinned "off" (and dropping any inherited SCHEDULERS_ENABLED below) so a developer .env cannot flip the harness into required lease mode.
    SCHEDULER_LEASE_MODE: "off",
};
delete env.SCHEDULERS_ENABLED;

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { env, stdio: "inherit", ...options });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

function dropDatabase() {
    run("dropdb", ["--host", "localhost", "--username", "postgres", "--if-exists", databaseName]);
}

try {
    dropDatabase();
    run("createdb", ["--host", "localhost", "--username", "postgres", databaseName]);
    run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);
    run("pnpm", ["run", "db:seed:e2e"]);
    // The directory path (not individual spec files) is passed so new specs
    // dropped into test/e2e/message-automation-cron are picked up without
    // touching this runner. Extra CLI args (e.g. jest -t filters) are forwarded.
    run("pnpm", [
        "exec",
        "jest",
        "test/e2e/message-automation-cron",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
        "--passWithNoTests",
        ...process.argv.slice(2),
    ]);
} finally {
    dropDatabase();
}
