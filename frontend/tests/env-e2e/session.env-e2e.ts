import { expect, test } from "@playwright/test";

test("saved session opens a protected page without the login screen", async ({ page }) => {
  const response = await page.goto("/clients");
  expect(response?.ok(), `GET /clients returned HTTP ${response?.status()}`).toBe(true);
  await expect(page).not.toHaveURL(/\/(login|select-branch)(\?|$)/);
  await expect(page.locator('[data-component^="desktop_clients"]').first()).toBeVisible();
});
