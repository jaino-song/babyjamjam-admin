import { defineConfig, devices } from "@playwright/test";

import { resolveE2eTarget } from "./tests/env-e2e/target";

/**
 * Real-login E2E against a running environment: local dev or the preview deploy.
 *   pnpm e2e:dev      → http://localhost:3000 (starts `pnpm run dev` unless one is running; needs the local backend)
 *   pnpm e2e:preview  → https://preview.admin.babyjamjam.com (PREVIEW USES THE PRODUCTION DB — test client/branch only)
 * Credentials come from the git-ignored frontend/.env.local; see tests/env-e2e/target.ts.
 */
const target = resolveE2eTarget();

export default defineConfig({
  testDir: "./tests/env-e2e",
  // Own suffix so neither the default Playwright config nor jest picks these up.
  testMatch: "**/*.env-e2e.ts",
  globalSetup: "./tests/env-e2e/global-setup",
  // One worker, no retries: every login counts toward the backend's 5-per-15-minutes limit,
  // and preview writes land in the production DB.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Preview's Cloud Run backend scales to zero; the first request can take ~20s.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: `playwright-report/env-${target.name}`, open: "never" }]],
  outputDir: `test-results/env-${target.name}`,
  use: {
    baseURL: target.baseURL,
    storageState: target.storageStatePath,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: target.name === "dev"
    ? {
      command: "pnpm run dev",
      // Probe a path the auth proxy skips: probing "/" would fire a local auto-login on every
      // poll and burn the 5-logins-per-15-minutes budget before global-setup logs in.
      url: `${target.baseURL}/favicon.ico`,
      reuseExistingServer: true,
      timeout: 180_000,
    }
    : undefined,
});
