import { test, expect } from "@playwright/test";

test.describe("Mobile nav: center chat + /all menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bottom nav has center chat and /all on mobile", async ({ page }) => {
    await page.goto("/dashboard");

    const nav = page.locator('[data-component="desktop_chrome_mobile-bottom-nav"]');
    await expect(nav).toBeVisible();

    // Center chat button.
    const chatLink = nav.getByRole("link", { name: "어시스턴트" });
    await expect(chatLink).toBeVisible();
    await expect(chatLink).toHaveAttribute("href", "/chat");

    // "전체" button should exist.
    const allLink = nav.getByRole("link", { name: "전체" });
    await expect(allLink).toBeVisible();

    // Navigate to /all.
    await allLink.click();
    await expect(page).toHaveURL(/\/all$/);
    await expect(page.locator('[data-component="desktop_all_menu_profile"]')).toBeVisible();
    await expect(page.locator('[data-component="desktop_v3_shortcut-grid"]')).toBeVisible();
    await expect(page.locator('[data-component="desktop_all_menu_content_nav"]')).toBeVisible();

    // Navigate to /chat via center button.
    await nav.getByRole("link", { name: "어시스턴트" }).click();
    await expect(page).toHaveURL(/\/chat$/);
  });
});
