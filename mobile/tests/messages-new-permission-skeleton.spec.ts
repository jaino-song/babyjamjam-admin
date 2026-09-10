import { expect, type Page, test } from "@playwright/test";

const FORM = '[data-component="mobile_messages_new_page_screen_form"]';
const LAUNCH_SCREEN = '[data-component="mobile_messages_permission-guard_loading"]';
const NAV_ROOT = '[data-component="mobile_messages_new_page_screen_form_section-nav_nav"]';
const NAV_SKELETON = `${NAV_ROOT} [data-loading="true"]`;
const NAV_BUTTON = `${NAV_ROOT} button:not([data-loading])`;
const CARD = "mobile_messages_new_page_screen_form_scroll_list-card";
const ACTION_BUTTON = `[data-component="${CARD}_header_action"]`;
const HEADER = `[data-component="${CARD}_header"]`;
const BODY = `[data-component="${CARD}_body"]`;

async function mockAuthUser(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "owner-1", name: "관리자", role: "owner" }),
    });
  });
}

test.describe("Mobile new-message permission skeletons", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the form and the real send action in place while approval loads", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    let releaseApproval: () => void = () => {};
    const approvalReady = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });

    await mockAuthUser(page);
    await page.route("**/api/settings/message-sender-approval**", async (route) => {
      await approvalReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          approvalStatus: "approved",
          isApproved: true,
          canRequest: true,
          requestedAt: null,
          approvedAt: null,
        }),
      });
    });

    await page.goto("/messages/new", { waitUntil: "domcontentloaded", timeout: 120_000 });

    // The full-screen launch screen must not appear; the form is on screen.
    await expect(page.locator(FORM)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(LAUNCH_SCREEN)).toHaveCount(0);

    // The section nav shows non-interactive skeleton pills, one per section.
    await expect(page.locator(NAV_SKELETON)).toHaveCount(5);
    await expect(page.locator(NAV_BUTTON)).toHaveCount(0);
    await expect(page.locator(NAV_ROOT)).toHaveAttribute("aria-busy", "true");

    // The "즉시 발송" action is the real (disabled) button from the start:
    // the action skeleton used to make the header taller and shift the form
    // downward once approval resolved.
    await expect(page.locator(ACTION_BUTTON)).toBeVisible();
    await expect(page.locator(ACTION_BUTTON)).toBeDisabled();

    const skeletonNavBox = await page.locator(NAV_ROOT).boundingBox();
    const skeletonFirstPillBox = await page.locator(NAV_SKELETON).first().boundingBox();
    const skeletonHeaderBox = await page.locator(HEADER).boundingBox();
    const skeletonBodyBox = await page.locator(BODY).boundingBox();
    await page.screenshot({ path: "/tmp/messages-new-permission-loading.png" });

    releaseApproval();

    // The loaded controls replace the skeletons in place.
    await expect(page.locator(NAV_SKELETON)).toHaveCount(0);
    await expect(page.locator(NAV_BUTTON)).toHaveCount(5);
    await expect(page.locator(ACTION_BUTTON)).toBeVisible();
    await expect(page.locator(NAV_ROOT)).not.toHaveAttribute("aria-busy", "true");

    const loadedNavBox = await page.locator(NAV_ROOT).boundingBox();
    const loadedFirstPillBox = await page.locator(NAV_BUTTON).first().boundingBox();
    const loadedHeaderBox = await page.locator(HEADER).boundingBox();
    const loadedBodyBox = await page.locator(BODY).boundingBox();
    await page.screenshot({ path: "/tmp/messages-new-permission-loaded.png" });

    // The header and the form body keep their exact footprint: no reflow when
    // the approval data lands.
    expect(skeletonHeaderBox).not.toBeNull();
    expect(loadedHeaderBox).not.toBeNull();
    expect(Math.abs((loadedHeaderBox?.y ?? 0) - (skeletonHeaderBox?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(
      Math.abs((loadedHeaderBox?.height ?? 0) - (skeletonHeaderBox?.height ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(skeletonBodyBox).not.toBeNull();
    expect(loadedBodyBox).not.toBeNull();
    expect(Math.abs((loadedBodyBox?.y ?? 0) - (skeletonBodyBox?.y ?? 0))).toBeLessThanOrEqual(1);

    // The skeleton pills keep the loaded pills' footprint: no reflow when data lands.
    expect(skeletonNavBox).not.toBeNull();
    expect(loadedNavBox).not.toBeNull();
    expect(Math.abs((loadedNavBox?.y ?? 0) - (skeletonNavBox?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((loadedNavBox?.height ?? 0) - (skeletonNavBox?.height ?? 0))).toBeLessThanOrEqual(
      1,
    );
    expect(skeletonFirstPillBox).not.toBeNull();
    expect(loadedFirstPillBox).not.toBeNull();
    expect(
      Math.abs((loadedFirstPillBox?.width ?? 0) - (skeletonFirstPillBox?.width ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((loadedFirstPillBox?.height ?? 0) - (skeletonFirstPillBox?.height ?? 0)),
    ).toBeLessThanOrEqual(1);
  });
});
