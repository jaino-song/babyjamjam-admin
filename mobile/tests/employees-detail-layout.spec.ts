import { expect, test } from "@playwright/test";

const MOCK_EMPLOYEES = [
  {
    id: 101,
    name: "김정인",
    workArea: ["incheon-namdong"],
    phone: "010-1111-2222",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-05-30",
    status: "working",
  },
  {
    id: 102,
    name: "박지영",
    workArea: [],
    phone: "010-3333-4444",
    grade: "B",
    openToNextWork: false,
    registeredDate: "2026-03-08T00:00:00.000Z",
    status: "unavailable",
  },
];

test.use({ viewport: { width: 390, height: 844 } });

test.describe("employees mobile detail layout", () => {
  test("uses the shared absolute detail-sheet geometry", async ({ page }) => {
    await page.route("**/api/employees**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_EMPLOYEES),
      });
    });

    await page.goto("/employees");
    await page.waitForLoadState("networkidle");

    const row = page.locator('[data-component="mobile-employees-row"]');
    await expect(row).toHaveCount(2);
    const assignedRow = page.locator('[data-component="mobile-employees-row"]', {
      hasText: "김정인",
    });
    await expect(assignedRow).toHaveCount(1);
    await assignedRow.click();

    const stack = page.locator('[data-component="mobile-employees-stack"]');
    const detailPage = page.locator('[data-component="mobile-employees-detail-page"]');
    const listPage = page.locator('[data-component="mobile-employees-list-page"]');

    await expect(stack).toHaveClass(/show-detail/);
    await expect(stack).toHaveCSS("position", "absolute");
    await expect(listPage).toHaveCSS("position", "absolute");
    await expect(detailPage).toHaveCSS("position", "absolute");
    await expect(detailPage).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    const geometry = await detailPage.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      return {
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        position: style.position,
        right: Math.round(rect.right),
        top: Math.round(rect.top),
      };
    });

    expect(geometry.position).toBe("absolute");
    expect(geometry.left).toBe(0);
    expect(geometry.right).toBe(390);
    expect(geometry.bottom).toBe(844);
    expect(geometry.top).toBeGreaterThan(0);
    expect(geometry.top).toBeLessThan(60);
    await expect(page.getByText("2026년 05월 30일")).toBeVisible();

    await page.getByRole("button", { name: "담당 고객" }).click();
    await expect(page.locator(".info-card-title", { hasText: "현재 담당" })).toBeVisible();
    await expect(page.locator(".info-card-title", { hasText: "이전 담당" })).toBeHidden();

    await page.getByRole("button", { name: "근무 내역" }).click();
    await expect(page.locator(".info-card-title", { hasText: "이전 담당" })).toBeVisible();
    await expect(page.getByText("윤정아 · A가1형")).toBeVisible();
    await expect(page.getByText("5월 9일 (오전) 방문")).toHaveCount(0);
    await expect(page.getByText("5월 10일 (오전) 예정")).toHaveCount(0);
    await expect(page.locator(".info-card-title", { hasText: /·\\s*\\d+[명건개]/ })).toHaveCount(0);
  });

  test("shows an empty state when the employee has no assigned client", async ({ page }) => {
    await page.route("**/api/employees**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_EMPLOYEES),
      });
    });

    await page.goto("/employees");
    await page.waitForLoadState("networkidle");

    const unassignedRow = page.locator('[data-component="mobile-employees-row"]', {
      hasText: "박지영",
    });
    await expect(unassignedRow).toHaveCount(1);
    await unassignedRow.click();
    await page.getByRole("button", { name: "담당 고객" }).click();

    await expect(page.locator('[data-component="mobile-employees-clients-empty"]')).toHaveText(
      "배정된 고객이 없습니다.",
    );
  });
});
