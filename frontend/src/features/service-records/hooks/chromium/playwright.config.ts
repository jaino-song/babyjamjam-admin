import { defineConfig, devices } from "@playwright/test";

/**
 * Real-Chromium check for the leave guard's history handling. Standalone on purpose:
 * no web server, no auth, kept out of the default jest run and the app e2e config.
 *
 *   npx playwright test -c src/features/service-records/hooks/chromium/playwright.config.ts
 */
export default defineConfig({
    testDir: ".",
    testMatch: "*.chromium.ts",
    reporter: "list",
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
