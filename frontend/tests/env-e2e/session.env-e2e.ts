import { expect, test } from "@playwright/test";

test("saved session opens a protected page without the login screen", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).not.toHaveURL(/\/(login|select-branch)(\?|$)/);
});
