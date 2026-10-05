import { test, expect, type Page } from "@playwright/test";
import { KR_BUILTIN_HOLIDAYS, nextBusinessDayKr } from "../src/lib/date/business-days";

type MockEmployee = {
  id: number;
  name: string;
} | null;

type MockClient = {
  id: number;
  name: string;
  birthday: string | null;
  dueDate: string | null;
  address: string;
  phone: string;
  primaryEmployee: MockEmployee;
  secondaryEmployee: MockEmployee;
  type: string;
  duration: number | null;
  fullPrice: number | null;
  grant: number | null;
  actualPrice: number | null;
  startDate: string | null;
  endDate: string | null;
  careCenter: boolean;
  voucherClient: boolean;
  breastPump: boolean;
  serviceStatus: string | null;
  eDocId: string | null;
  hasSigned: boolean;
  documentStatus: string | null;
};

type ClientsApiResponse = {
  data: MockClient[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

// The dashboard now reads one `/dashboard/overview` payload (stats + first client page) and lists the
// active contracts that end on the next business day. Pin "today" so that date is deterministic.
const TODAY_ISO = "2026-10-13"; // Tuesday, a business day
const NEXT_BUSINESS_DAY = nextBusinessDayKr(TODAY_ISO);

const DEFAULT_STATS = {
  activeClients: 1,
  contractsNotSent: 2,
  contractsPendingSignature: 3,
  upcomingThisMonth: 4,
  upcomingNextMonth: 5,
};

function createMockClient({
  id,
  name,
  ...overrides
}: Partial<MockClient> & Pick<MockClient, "id" | "name">): MockClient {
  return {
    id,
    name,
    birthday: null,
    dueDate: null,
    address: "서울시 강남구",
    phone: "010-1111-2222",
    primaryEmployee: { id: 1, name: "이영희" },
    secondaryEmployee: null,
    type: "산모신생아",
    duration: 25,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

function createClientsResponse(clients: MockClient[], total = clients.length): ClientsApiResponse {
  return {
    data: clients,
    total,
    page: 1,
    limit: 50,
    totalPages: Math.max(1, Math.ceil(total / 50)),
  };
}

async function mockOverviewRoute(
  page: Page,
  handler: () => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>
) {
  await page.route("**/api/dashboard/overview**", async (route) => {
    const response = await handler();
    await route.fulfill({
      status: response.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });
}

function overviewBody(clients: MockClient[], total = clients.length) {
  return { stats: DEFAULT_STATS, clients: createClientsResponse(clients, total) };
}

const ITEM = '[data-component="desktop_dashboard_split_activities-panel_list-panel_list_item"]';

test.describe("Dashboard activities panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(`${TODAY_ISO}T12:00:00+09:00`));
    // Branch holiday calendar for the apps' business-day maths (built-in list, no branch changes).
    await page.route("**/api/branches/*/holidays**", async (route) => {
        const year = Number(new URL(route.request().url()).searchParams.get("year"));
        const holidays = KR_BUILTIN_HOLIDAYS
            .filter((date) => date.startsWith(`${year}-`))
            .map((date) => ({ date, name: "공휴일", source: "builtin", excluded: false, overrideId: null }));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ year, revision: 1, supported: holidays.length > 0, synced: true, lastSyncedAt: null, holidays, inactiveOverrides: [] }) });
    });
  });

  test("lists only active contracts that end on the next business day", async ({ page }) => {
    await mockOverviewRoute(page, () => ({
      body: overviewBody([
        createMockClient({ id: 1, name: "내일종료", serviceStatus: "active", endDate: NEXT_BUSINESS_DAY }),
        createMockClient({ id: 2, name: "오늘종료", serviceStatus: "active", endDate: TODAY_ISO }),
        createMockClient({ id: 3, name: "교체요청", serviceStatus: "replacement_requested", endDate: NEXT_BUSINESS_DAY }),
        createMockClient({ id: 4, name: "이미완료", serviceStatus: "completed", endDate: NEXT_BUSINESS_DAY }),
      ]),
    }));

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "최근 현황" })).toBeVisible();

    const items = page.locator(ITEM);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("내일종료");
    await expect(items.first()).toContainText("서비스 종료 1 영업일 남음");
    await expect(page.getByText("오늘종료")).toHaveCount(0);
    await expect(page.getByText("교체요청")).toHaveCount(0);
    await expect(page.getByText("이미완료")).toHaveCount(0);
  });

  test("derives the stat cards from the loaded clients", async ({ page }) => {
    await mockOverviewRoute(page, () => ({
      body: overviewBody([
        createMockClient({ id: 1, name: "진행1", serviceStatus: "active", endDate: NEXT_BUSINESS_DAY }),
        createMockClient({ id: 2, name: "진행2", serviceStatus: "active", endDate: "2026-11-30" }),
        createMockClient({ id: 3, name: "대기", serviceStatus: "waiting", startDate: "2026-10-15" }),
      ]),
    }));

    await page.goto("/dashboard");

    const stat = (label: string) =>
      page.locator('[data-slot="stat-mini-content"]').filter({ has: page.locator('[data-slot="stat-mini-label"]', { hasText: label }) });
    await expect(stat("서비스 진행 중")).toContainText("2");
    await expect(stat("곧 시작 예정")).toContainText("1");
    await expect(stat("계약서 필요")).toContainText("0");
  });

  test("detail panel opens when clicking an activity item", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await mockOverviewRoute(page, () => ({
      body: overviewBody([
        createMockClient({
          id: 1,
          name: "김종료",
          address: "서울시 강남구",
          phone: "010-1111-2222",
          serviceStatus: "active",
          endDate: NEXT_BUSINESS_DAY,
        }),
      ]),
    }));

    await page.goto("/dashboard");

    const splitTrack = page.locator('[data-component="desktop_dashboard_split-layout"] > [data-slot="split-layout-track"]');
    await expect(splitTrack).toBeVisible();

    await expect
      .poll(async () => splitTrack.evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("translateX(0");

    const firstItem = page.locator(ITEM).first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();

    const detailPanel = page.locator('[data-component="desktop_dashboard_client-detail_panel"]');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText("김종료");

    await expect
      .poll(async () => splitTrack.evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("translateX(calc(-1 *");
  });

  test("shows error state with retry button on API failure", async ({ page }) => {
    let shouldFail = true;

    await mockOverviewRoute(page, () => {
      if (shouldFail) {
        return { status: 500, body: { message: "Internal Server Error" } };
      }
      return {
        body: overviewBody([
          createMockClient({ id: 1, name: "김종료", serviceStatus: "active", endDate: NEXT_BUSINESS_DAY }),
        ]),
      };
    });

    await page.goto("/dashboard");

    await expect(page.getByText("데이터를 불러올 수 없습니다")).toBeVisible();
    const retryButton = page.getByRole("button", { name: "다시 시도" });
    await expect(retryButton).toBeVisible();

    shouldFail = false;
    await retryButton.click();
    await expect(page.getByText("김종료")).toBeVisible();
  });

  test("shows empty state when no contract ends on the next business day", async ({ page }) => {
    await mockOverviewRoute(page, () => ({ body: overviewBody([]) }));

    await page.goto("/dashboard");

    await expect(page.getByText("종료 1영업일 전인 계약이 없습니다")).toBeVisible();
    await expect(page.getByText("데이터를 불러올 수 없습니다")).toHaveCount(0);
  });

  test("loads the next client page when more clients exist than the first page holds", async ({ page }) => {
    const pageRequests: string[] = [];
    await mockOverviewRoute(page, () => ({
      body: {
        stats: DEFAULT_STATS,
        clients: {
          data: [createMockClient({ id: 1, name: "첫페이지", serviceStatus: "active", endDate: NEXT_BUSINESS_DAY })],
          total: 100,
          page: 1,
          limit: 50,
          totalPages: 2,
        },
      },
    }));
    await page.route("**/api/clients?*", async (route) => {
      const url = new URL(route.request().url());
      pageRequests.push(url.searchParams.get("page") ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [createMockClient({ id: 2, name: "둘째페이지", serviceStatus: "active", endDate: NEXT_BUSINESS_DAY })],
          total: 100,
          page: 2,
          limit: 50,
          totalPages: 2,
        }),
      });
    });

    await page.goto("/dashboard");

    await expect(page.locator(ITEM).filter({ hasText: "첫페이지" })).toBeVisible();
    await expect(page.locator(ITEM).filter({ hasText: "둘째페이지" })).toBeVisible();
    expect(pageRequests).toEqual(["2"]);
    // Infinite scroll replaced the old "전체 고객 보기" overflow link.
    await expect(page.getByRole("link", { name: /전체 고객 보기/ })).toHaveCount(0);
  });
});
