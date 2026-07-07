import { expect, test } from "@playwright/test";

const CLIENT = {
  id: 101,
  name: "테스트 고객",
  createdAt: "2026-05-30T01:00:00.000Z",
  updatedAt: "2026-05-30T01:00:00.000Z",
  birthday: "900101",
  dueDate: "2026-05-30",
  address: "인천 남동구",
  phone: "010-1111-2222",
  primaryEmployee: { id: 1, name: "김정인" },
  secondaryEmployee: null,
  type: "A통합2형",
  duration: 10,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-05-31",
  endDate: "2026-06-09",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "active",
  eDocId: "DOC-CLIENT-101",
  hasSigned: true,
  documentStatus: "completed",
};

const ACTIVE_CLIENT_WITHOUT_CONTRACT = {
  ...CLIENT,
  id: 102,
  name: "계약서 없는 고객",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

test.describe("Mobile clients detail labels", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/employees", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/message-logs?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  });

  test("uses the compact notification labels in the client detail sheet", async ({ page }) => {
    await page.route("**/api/clients?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [CLIENT],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      });
    });

    await page.goto("/clients");
    await expect(page.locator('[data-component="mobile-clients-row"]')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-component="mobile-clients-row"]', { hasText: CLIENT.name }).click();
    const notificationTabButton = page.locator('[data-component="mobile-redesign-detail-tabs"] [data-tab="alimtalk"]');
    await expect(notificationTabButton).toBeVisible();
    await notificationTabButton.dispatchEvent("click");

    const alimtalkTab = page.locator('[data-component="mobile-clients-alimtalk-tab"]');
    await expect(alimtalkTab).toBeVisible();
    await expect(alimtalkTab.locator(".info-card-title")).toHaveText("발송 내역");
    await expect(page.getByRole("button", { name: "알림톡 발송 현황" })).toHaveCount(0);
    await expect(alimtalkTab.locator(".info-card-title")).not.toContainText("알림톡 ·");
  });

  test("shows the missing contract badge next to the client status badge", async ({ page }) => {
    await page.route("**/api/clients?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [ACTIVE_CLIENT_WITHOUT_CONTRACT],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      });
    });

    await page.goto("/clients");
    await expect(page.locator('[data-component="mobile-clients-row"]')).toBeVisible({ timeout: 15000 });

    const filterPills = page.locator('[data-component="mobile-redesign-filter-pill"]');
    await expect(filterPills.nth(0)).toContainText("전체");
    await expect(filterPills.nth(0)).toContainText("1");
    await expect(filterPills.nth(1)).toContainText("계약서 필요");
    await expect(filterPills.nth(1)).toContainText("1");
    await filterPills.nth(1).click();

    const row = page.locator('[data-component="mobile-clients-row"]', {
      hasText: ACTIVE_CLIENT_WITHOUT_CONTRACT.name,
    });
    const badges = row.locator('[data-component="mobile-redesign-list-row-badges"] [data-component="status-badge"]');

    await expect(badges).toHaveText(["계약서 필요"]);
    await expect(row.locator('[data-component="mobile-redesign-list-row-badges-more"]')).toHaveText("+1");
  });
});
