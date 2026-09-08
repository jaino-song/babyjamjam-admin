import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic Phase 6 browser configuration.
 *
 * This config intentionally does not load the repository's auth.json or
 * global setup. The spec supplies a scoped E2E cookie and intercepts every
 * API boundary with a local fixture.
 */
const localOrigin = "http://127.0.0.1:3107";

export default defineConfig({
    testDir: "./tests",
    testMatch: /admin-service-record-editor\.spec\.ts/,
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: "line",
    use: {
        baseURL: localOrigin,
        headless: true,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
    },
    projects: [
        {
            name: "chromium-local",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "NEXT_PUBLIC_E2E_TEST=true NEXT_TELEMETRY_DISABLED=1 NODE_ENV=development pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3107",
        url: localOrigin,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
            NEXT_PUBLIC_E2E_TEST: "true",
            NEXT_TELEMETRY_DISABLED: "1",
            NODE_ENV: "development",
        },
    },
});
