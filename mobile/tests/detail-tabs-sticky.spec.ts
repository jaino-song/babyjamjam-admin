import { expect, type Page, test } from "@playwright/test";

// Shared sticky-tabs contract for detail sheets: while the sheet body
// (`.detail-body`) scrolls, the tab row must pin flush under the fixed sheet
// header. Regression: `top: 0` inside the padded scrollport left a
// `--detail-body-pad-top` seam of scrolled rows between header and tabs, and
// the sticky rule itself was scoped to the clients/calls routes only.
// Producers: mobile/src/components/app/mobile-redesign/redesign.css
// (.detail-body padding / .detail-tabs sticky) and detail-sheet.tsx
// (MobileDetailStack chrome header + MobileDetailPage scroll body).

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

const CLIENT_HEADER = "mobile_clients_detail-sheet_stack_detail-page_header";
const CLIENT_BODY = "mobile_clients_detail-sheet_stack_detail-page_content";
const CLIENT_TABS = "mobile_clients_detail-sheet_stack_detail-page_content_tabs";
const CLIENT_LIST_ROW =
  "mobile_clients_detail-sheet_stack_list-page_content_list-card_body_section_row";

const EMPLOYEE_HEADER = "mobile_employees_detail-sheet_stack_detail-page_header";
const EMPLOYEE_BODY = "mobile_employees_detail-sheet_stack_detail-page_body";
const EMPLOYEE_TABS = "mobile_employees_detail-sheet_stack_detail-page_body_tabs";
const EMPLOYEE_LIST_ROW =
  "mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row";

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
];

// Tall enough that the history panel always overflows the test viewport, so
// the sticky constraint is genuinely engaged.
const MOCK_WORK_HISTORY = Array.from({ length: 12 }, (_, index) => ({
  scheduleId: 300 + index,
  clientId: 201 + index,
  clientName: `고객 ${index + 1}`,
  role: index % 2 === 0 ? "primary" : "secondary",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  status: "completed",
}));

interface StickyState {
  gap: number;
  tabsPosition: string;
  tabsBackground: string;
}

async function readStickyState(
  page: Page,
  headerComponent: string,
  tabsComponent: string,
): Promise<StickyState> {
  const state = await page.evaluate(
    ({ headerComponent, tabsComponent }) => {
      const header = document.querySelector(`[data-component="${headerComponent}"]`);
      const tabs = document.querySelector(`[data-component="${tabsComponent}"]`);
      if (!header || !tabs) {
        return null;
      }

      const tabsStyle = getComputedStyle(tabs);
      return {
        gap: tabs.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
        tabsPosition: tabsStyle.position,
        tabsBackground: tabsStyle.backgroundColor,
      };
    },
    { headerComponent, tabsComponent },
  );

  if (!state) {
    throw new Error(`Header or tabs not found: ${headerComponent} / ${tabsComponent}`);
  }

  return state;
}

async function scrollBodyToEnd(page: Page, bodyComponent: string): Promise<void> {
  const body = page.locator(`[data-component="${bodyComponent}"]`);
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => body.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
}

test.describe("mobile detail sheet sticky tabs", () => {
  test.use({ viewport: { width: 390, height: 500 } });

  test("clients detail tabs pin flush under the sheet header while scrolling", async ({ page }) => {
    await page.route("**/api/employees", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route("**/api/message-logs**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route(`**/api/clients/${CLIENT.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CLIENT),
      });
    });
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
    const row = page.locator(`[data-component="${CLIENT_LIST_ROW}"]`, { hasText: CLIENT.name });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    await expect(
      page.locator('[data-component="mobile_clients_detail-sheet_stack_detail-page"]'),
    ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(page.locator(`[data-component="${CLIENT_TABS}"]`)).toBeVisible();

    await scrollBodyToEnd(page, CLIENT_BODY);

    const state = await readStickyState(page, CLIENT_HEADER, CLIENT_TABS);
    expect(state.tabsPosition).toBe("sticky");
    expect(state.tabsBackground).not.toBe("rgba(0, 0, 0, 0)");
    // Flush: no padding seam between the chrome header and the pinned tabs.
    expect(Math.abs(state.gap)).toBeLessThanOrEqual(1);
  });

  test("employees detail tabs pin flush under the sheet header while scrolling", async ({
    page,
  }) => {
    await page.route("**/api/employees**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }

      const pathname = new URL(route.request().url()).pathname;
      let body: unknown;
      if (pathname === "/api/employees") {
        body = MOCK_EMPLOYEES;
      } else if (pathname === "/api/employees/101/active-clients") {
        body = [];
      } else if (pathname === "/api/employees/101/work-history") {
        body = {
          data: MOCK_WORK_HISTORY,
          total: MOCK_WORK_HISTORY.length,
          page: 1,
          limit: 20,
          totalPages: 1,
        };
      } else {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    await page.goto("/employees");
    const row = page.locator(`[data-component="${EMPLOYEE_LIST_ROW}"]`, { hasText: "김정인" });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    await expect(
      page.locator('[data-component="mobile_employees_detail-sheet_stack_detail-page"]'),
    ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(page.locator(`[data-component="${EMPLOYEE_TABS}"]`)).toBeVisible();

    await page.getByRole("button", { name: "근무 내역" }).click();
    await expect(
      page.locator('[data-component="mobile_employees_detail-panel_info-card-4_history-row"]'),
    ).toHaveCount(MOCK_WORK_HISTORY.length);

    await scrollBodyToEnd(page, EMPLOYEE_BODY);

    const state = await readStickyState(page, EMPLOYEE_HEADER, EMPLOYEE_TABS);
    expect(state.tabsPosition).toBe("sticky");
    expect(state.tabsBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(Math.abs(state.gap)).toBeLessThanOrEqual(1);
  });
});
