import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APPROVED_DATABASE_URL =
    "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4";
const backendDirectory = fileURLToPath(new URL("..", import.meta.url));

function assertApprovedUrl(variableName) {
    const value = process.env[variableName];
    if (value !== APPROVED_DATABASE_URL) {
        throw new Error(`Refusing admin service-record HTTP E2E: ${variableName} is not the approved disposable target`);
    }
}

// Validate both URLs before Jest imports the helper that can construct Prisma.
assertApprovedUrl("DATABASE_URL");
assertApprovedUrl("DIRECT_URL");

const env = {
    ...process.env,
    NODE_ENV: "test",
    SERVICE_RECORD_EDIT_HTTP_E2E: "1",
};

const result = spawnSync(
    "pnpm",
    [
        "exec",
        "jest",
        "--runTestsByPath",
        "test/e2e/admin-service-record-edit-http.e2e.spec.ts",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
    ],
    {
        cwd: backendDirectory,
        env,
        stdio: "inherit",
    },
);

if (result.error) {
    throw result.error;
}
if (result.status !== 0) {
    throw new Error(`admin service-record HTTP E2E failed with exit code ${result.status ?? "unknown"}`);
}
