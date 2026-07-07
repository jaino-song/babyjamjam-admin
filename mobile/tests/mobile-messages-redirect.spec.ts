import { expect, test } from "@playwright/test";

test.describe("Mobile messages route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders the messages automation page at /messages", async ({ page }) => {
    await page.goto("/messages");

    await expect(page).toHaveURL(/\/messages/);
    await expect(page.locator('[data-component="alimtalk-trigger-card-title"]')).toContainText("메시지");
    await expect(page.locator('[data-component="mobile-messages-new"]')).toBeVisible();
  });
});
