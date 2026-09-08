import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const e2ePort = process.env.E2E_PORT ?? "4317";
const baseURL = process.env.BASE_URL ?? `http://localhost:${e2ePort}`;
const parsedBaseURL = new URL(baseURL);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

if (parsedBaseURL.protocol !== "http:" || !loopbackHosts.has(parsedBaseURL.hostname)) {
  throw new Error(`Phase 3 synthetic E2E requires an HTTP loopback BASE_URL; received ${baseURL}`);
}

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
