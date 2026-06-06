import { expect, test } from "@playwright/test";

const nowIso = new Date().toISOString();

test.describe("Mobile messages filter skeletons", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders whole filter pills as skeletons while message counts load", async ({ page }) => {
    let releaseLogs: () => void = () => {};
    const logsReady = new Promise<void>((resolve) => {
      releaseLogs = resolve;
    });

    await page.route("**/api/message-templates**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "template-1" }], total: 1, page: 1, limit: 100, totalPages: 1 }),
      });
    });
    await page.route("**/api/alimtalk-trigger-jobs/upcoming**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route("**/api/alimtalk-logs**", async (route) => {
      await logsReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            provider: "aligo",
            templateKey: "CLIENT_WELCOME",
            receiver: "010-0000-0001",
            clientId: 1,
            messageBody: "환영합니다.",
            status: "sent",
            errorMessage: null,
            attempts: 1,
            createdAt: nowIso,
            ruleName: "고객 등록 환영",
            eventType: "CLIENT_CREATED",
            recipientName: "김고객",
            clientName: "김고객",
            employeeName: null,
          },
          {
            id: 2,
            provider: "sms",
            templateKey: "REMINDER",
            receiver: "010-0000-0002",
            clientId: 2,
            messageBody: "안내 문자입니다.",
            status: "failed",
            errorMessage: "failed",
            attempts: 1,
            createdAt: nowIso,
            ruleName: "수동 문자",
            eventType: null,
            recipientName: "이문자",
            clientName: "이문자",
            employeeName: null,
          },
        ]),
      });
    });

    await page.goto("/messages");
    await expect(page.locator('[data-component="mobile-messages-filter-row"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]')).toHaveCount(4);

    const skeletonGeometry = await page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]').evaluateAll((pills) =>
      pills.map((pill) => {
        const rect = pill.getBoundingClientRect();
        return { y: rect.y, height: rect.height };
      })
    );

    releaseLogs();

    await expect(page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"]')).toHaveCount(4);
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"]', { hasText: "전체" })).toContainText("2");
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"]', { hasText: "알림톡" })).toContainText("1");
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"]', { hasText: "SMS" })).toContainText("1");
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"]', { hasText: "실패" })).toContainText("1");

    const loadedGeometry = await page.locator('[data-component="mobile-redesign-filter-pill"]').evaluateAll((pills) =>
      pills.map((pill) => {
        const rect = pill.getBoundingClientRect();
        return { y: rect.y, height: rect.height };
      })
    );

    expect(loadedGeometry).toHaveLength(skeletonGeometry.length);
    loadedGeometry.forEach((pill, index) => {
      expect(Math.abs(pill.y - skeletonGeometry[index].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(pill.height - skeletonGeometry[index].height)).toBeLessThanOrEqual(1);
    });
  });
});
