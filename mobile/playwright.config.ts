import { defineConfig, devices } from '@playwright/test';

// Quarantined from CI until rewritten/unblocked — see tests/QUARANTINE.md
const CI_QUARANTINE = [
  '**/nav-indicator-diagnose.spec.ts', // local-only diagnostic: real login with dev credentials, dev server timing capture
  '**/nav-slide-dense.spec.ts', // local-only diagnostic: dense frame capture, real login
  '**/animation-plan-visual-verify.spec.ts', // animation/visual diagnostic, timing-fragile in CI
  '**/dashboard-activities-animation.spec.ts', // animation diagnostic (addInitScript event collection)
];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.CI ? CI_QUARANTINE : [],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* 2 workers on CI (matches the runner's cores): 266 tests at 1 worker
     with retries exceed any sane job timeout against the real backend. */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Use saved authentication state */
    storageState: 'auth.json',
  },
  globalSetup: './tests/global-setup',

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm run dev',
    url: process.env.BASE_URL || 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180 * 1000,
    env: {
      NEXT_PUBLIC_E2E_TEST: 'true',
    },
  },
});
