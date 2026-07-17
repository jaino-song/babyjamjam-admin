import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "auth-token-response.spec.ts",
  reporter: "list",
  workers: 1,
});
