import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_E2E_PORT = 4317;
const DEFAULT_HTTP_PORT = 80;
const configuredBaseURL = process.env.BASE_URL;
const configuredE2EPort = process.env.E2E_PORT;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parsePort(value, source) {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Phase 3 synthetic E2E requires ${source} to be a decimal port from 1 to 65535; received ${value}`,
    );
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Phase 3 synthetic E2E requires ${source} to be a decimal port from 1 to 65535; received ${value}`,
    );
  }

  return port;
}

const explicitE2EPort = configuredE2EPort === undefined
  ? undefined
  : parsePort(configuredE2EPort, "E2E_PORT");
const baseURL = configuredBaseURL ?? `http://localhost:${explicitE2EPort ?? DEFAULT_E2E_PORT}`;
let parsedBaseURL;
try {
  parsedBaseURL = new URL(baseURL);
} catch {
  throw new Error(`Phase 3 synthetic E2E requires BASE_URL to be a valid URL; received ${baseURL}`);
}

if (parsedBaseURL.protocol !== "http:" || !loopbackHosts.has(parsedBaseURL.hostname)) {
  throw new Error(`Phase 3 synthetic E2E requires an HTTP loopback BASE_URL; received ${baseURL}`);
}

const baseURLPort = parsedBaseURL.port === ""
  ? DEFAULT_HTTP_PORT
  : parsePort(parsedBaseURL.port, "BASE_URL");

if (configuredBaseURL !== undefined && explicitE2EPort !== undefined && explicitE2EPort !== baseURLPort) {
  throw new Error(
    `Phase 3 synthetic E2E requires BASE_URL port ${baseURLPort} and E2E_PORT ${explicitE2EPort} to match`,
  );
}

const e2ePort = explicitE2EPort ?? (configuredBaseURL === undefined ? DEFAULT_E2E_PORT : baseURLPort);

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.PHASE3_TEST_MATCH ?? "phase3-*.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: process.env.PHASE3_REPORTER ?? [["list"], ["html", { outputFolder: "phase3-report", open: "never" }]],
  use: {
    baseURL,
    storageState: process.env.PHASE3_AUTH_STORAGE_STATE ?? "/tmp/babyjamjam-mobile-phase3-auth.json",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  globalSetup: path.join(configDir, "phase3-e2e-global-setup.mjs"),
  webServer: {
    command: `pnpm exec next dev --port ${e2ePort}`,
    cwd: configDir,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
      NEXT_PUBLIC_E2E_TEST: "true",
      E2E_TEST: "true",
    },
  },
});
