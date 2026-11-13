import { expect, test } from "@playwright/test";

test.describe("Mobile messages route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("redirects /messages to the maker while explicit send links retain their query", async ({ page }) => {
    await page.goto("/messages");
    await expect(page).toHaveURL(/\/messages\/compose$/);
    await expect(page.getByRole("button", { name: "메세지 제작", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.goto("/messages/new?template=PRICE_INFO");
    await expect(page).toHaveURL(/\/messages\/new\?template=PRICE_INFO$/);
    await expect(page.locator('form[data-form="messages-new-form"]')).toBeVisible();
  });
});
