import { expect, test } from "@playwright/test";

/**
 * This is the UI side of the service-record contract. `totalSessions: 4` is a
 * synthetic fixture so it can prove the rendered slot count without mutating
 * the local backend. The existing service-record suite separately exercises
 * the shared business-day calculation and the authenticated backend helper.
 */
test("renders exactly four service-record slots from the supplied session count", async ({ page }) => {
  const token = "phase3-service-record-four-slots";
  await page.route("**/api/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route(`**/api/service-record/${token}/link`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true }) });
  });
  await page.route(`**/api/service-record/${token}/verify`, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, accessToken: "phase3-access-token" }),
    });
  });
  await page.route(`**/api/service-record/${token}/context`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employee: { id: 11, name: "테스트 제공자" },
        client: { id: 501, name: "테스트 고객" },
        totalSessions: 4,
        startDate: "2026-09-03",
        header: {
          momName: "테스트 산모",
          momBirth: "900101",
          babyName: "테스트 아기",
          babyBirth: "260903",
          babyWeight: "3.2",
          deliveryType: "자연분만",
        },
        sessions: [],
      }),
    });
  });

  await page.goto(`/service-record/${token}`);
  await expect(page.getByText("제공기록표", { exact: true })).toBeVisible();
  const dayButtons = page.locator('[data-component="mobile_service-record_wizard_body_day-grid"] > button');
  await expect(dayButtons).toHaveCount(4);
  await expect(
    page.locator('[data-component="mobile_service-record_wizard_body_day-grid_day_number"]'),
  ).toHaveCount(4);
  await expect(
    page.locator('[data-component="mobile_service-record_wizard_body_day-grid_day_number"]').filter({ hasText: "4" }),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-component="mobile_service-record_wizard_body_day-grid_day_number"]').filter({ hasText: "5" }),
  ).toHaveCount(0);
});
