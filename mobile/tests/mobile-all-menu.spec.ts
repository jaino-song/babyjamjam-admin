import { test, expect } from "@playwright/test";

test.describe("Mobile nav: center chat + /all menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dashboard hides chat bar on mobile; bottom nav has center chat and /all", async ({ page }) => {
    await page.goto("/dashboard");

    // ChatWidget bar should not be visible on mobile dashboard.
    await expect(page.locator('[data-component="chat-widget"]')).toBeHidden();

    const nav = page.locator('[data-component="mobile-bottom-nav"]');
    await expect(nav).toBeVisible();

    // Center chat button.
    await expect(page.locator('[data-component="mobile-bottom-nav-chat"]')).toBeVisible();

    // "전체" button should exist.
    await expect(page.locator('[data-component="mobile-bottom-nav-all"]')).toBeVisible();

    // Navigate to /all.
    await page.click('[data-component="mobile-bottom-nav-all"]');
    await expect(page).toHaveURL(/\/all$/);
    await expect(page.locator('[data-component="all-menu-profile"]')).toBeVisible();
    await expect(page.locator('[data-component="all-menu-shortcuts"]')).toBeVisible();
    await expect(page.locator('[data-component="all-menu-nav"]')).toBeVisible();

    // Navigate to /chat via center button.
    await page.click('[data-component="mobile-bottom-nav-chat"]');
    await expect(page).toHaveURL(/\/chat$/);
  });
});
