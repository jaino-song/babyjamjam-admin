import { expect, type Page, test } from "@playwright/test";

const FORM = '[data-component="mobile_messages_new_page_screen_form"]';
const LAUNCH_SCREEN = '[data-component="mobile_messages_permission-guard_loading"]';
const NAV_ROOT = '[data-component="mobile_messages_new_page_screen_form_section-nav_nav"]';
const NAV_SKELETON = `${NAV_ROOT} [data-loading="true"]`;
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

test.describe("Mobile new-message approval loading", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the form and the real send action in place while approval loads", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    let releaseApproval: () => void = () => {};
    const approvalReady = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });

    await mockAuthUser(page);
    if (!baseURL) throw new Error("The owner fixture requires the configured baseURL");
    await page.context().addCookies([{ name: "e2e_role", value: "owner", url: baseURL }]);
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

    try {
      const approvalRequested = page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/settings/message-sender-approval",
      );
      await page.goto("/messages/new", { waitUntil: "domcontentloaded", timeout: 120_000 });
      await approvalRequested;

      // The full-screen launch screen must not appear; the form is on screen.
      await expect(page.locator(FORM)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(LAUNCH_SCREEN)).toHaveCount(0);

      const sectionNavigation = page.locator(NAV_ROOT);
      const expectedLabels = ["메세지 제작", "전송하기", "발송 기록", "템플릿", "자동 전송", "설정"];
      const makerButton = sectionNavigation.getByRole("button", { name: "메세지 제작", exact: true });

      // Real navigation remains mounted; approval only gates sending sections.
      await expect(page.locator(NAV_SKELETON)).toHaveCount(0);
      await expect(sectionNavigation.getByRole("button")).toHaveCount(6);
      await expect(sectionNavigation.getByRole("button")).toHaveText(expectedLabels);
      await expect(makerButton).toBeEnabled();
      await expect(sectionNavigation.getByRole("button", { name: "설정", exact: true })).toBeEnabled();
      for (const label of ["전송하기", "발송 기록", "템플릿", "자동 전송"]) {
        await expect(sectionNavigation.getByRole("button", { name: label, exact: true })).toBeDisabled();
      }
      await expect(sectionNavigation).not.toHaveAttribute("aria-busy", "true");

      // The "즉시 발송" action is the real (disabled) button from the start:
      // the action skeleton used to make the header taller and shift the form
      // downward once approval resolved.
      await expect(page.locator(ACTION_BUTTON)).toBeVisible();
      await expect(page.locator(ACTION_BUTTON)).toHaveText("즉시 발송");
      await expect(page.locator(ACTION_BUTTON)).toBeDisabled();

      const pendingNavBox = await sectionNavigation.boundingBox();
      const pendingFirstPillBox = await makerButton.boundingBox();
      const pendingHeaderBox = await page.locator(HEADER).boundingBox();
      const pendingBodyBox = await page.locator(BODY).boundingBox();
      await page.screenshot({ path: "/tmp/messages-new-permission-loading.png" });

      releaseApproval();

      // Approval enables the same six controls in place for the owner.
      await expect(page.locator(NAV_SKELETON)).toHaveCount(0);
      await expect(sectionNavigation.getByRole("button")).toHaveCount(6);
      await expect(sectionNavigation.getByRole("button")).toHaveText(expectedLabels);
      for (const label of expectedLabels) {
        await expect(sectionNavigation.getByRole("button", { name: label, exact: true })).toBeEnabled();
      }
      await expect(page.locator(ACTION_BUTTON)).toBeVisible();
      await expect(page.locator(ACTION_BUTTON)).toHaveText("즉시 발송");
      await expect(page.locator(ACTION_BUTTON)).toBeEnabled();
      await expect(page.locator(NAV_ROOT)).not.toHaveAttribute("aria-busy", "true");

      const loadedNavBox = await page.locator(NAV_ROOT).boundingBox();
      const loadedFirstPillBox = await makerButton.boundingBox();
      const loadedHeaderBox = await page.locator(HEADER).boundingBox();
      const loadedBodyBox = await page.locator(BODY).boundingBox();
      await page.screenshot({ path: "/tmp/messages-new-permission-loaded.png" });

      // The header and the form body keep their exact footprint: no reflow when
      // the approval data lands.
      expect(pendingHeaderBox).not.toBeNull();
      expect(loadedHeaderBox).not.toBeNull();
      expect(Math.abs((loadedHeaderBox?.y ?? 0) - (pendingHeaderBox?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(
        Math.abs((loadedHeaderBox?.height ?? 0) - (pendingHeaderBox?.height ?? 0)),
      ).toBeLessThanOrEqual(1);
      expect(pendingBodyBox).not.toBeNull();
      expect(loadedBodyBox).not.toBeNull();
      expect(Math.abs((loadedBodyBox?.y ?? 0) - (pendingBodyBox?.y ?? 0))).toBeLessThanOrEqual(1);

      // Navigation and the first real control keep their footprint when data lands.
      expect(pendingNavBox).not.toBeNull();
      expect(loadedNavBox).not.toBeNull();
      expect(Math.abs((loadedNavBox?.y ?? 0) - (pendingNavBox?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((loadedNavBox?.height ?? 0) - (pendingNavBox?.height ?? 0))).toBeLessThanOrEqual(
        1,
      );
      expect(pendingFirstPillBox).not.toBeNull();
      expect(loadedFirstPillBox).not.toBeNull();
      expect(
        Math.abs((loadedFirstPillBox?.width ?? 0) - (pendingFirstPillBox?.width ?? 0)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs((loadedFirstPillBox?.height ?? 0) - (pendingFirstPillBox?.height ?? 0)),
      ).toBeLessThanOrEqual(1);
      expect(Math.abs((loadedFirstPillBox?.x ?? 0) - (pendingFirstPillBox?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((loadedFirstPillBox?.y ?? 0) - (pendingFirstPillBox?.y ?? 0))).toBeLessThanOrEqual(1);
    } finally {
      releaseApproval();
    }
  });
});
