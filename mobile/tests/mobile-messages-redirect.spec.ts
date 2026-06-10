import { expect, test } from "@playwright/test";

test.describe("Mobile messages route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("redirects /messages to the alimtalk automation page", async ({ page }) => {
    await page.goto("/messages");

    await expect(page).toHaveURL(/\/alimtalk/);
  });
});
