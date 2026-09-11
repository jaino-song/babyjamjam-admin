import { expect, type Page, test } from "@playwright/test";

// Pins the list-skeleton no-reflow contract for the surfaces whose skeletons
// used to change size when the data landed. Rows are measured only after
// finite entrance animations settle; the pulsing skeleton animation is
// deliberately ignored.

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const animations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming?.();
      const iterations = timing ? Number(timing.iterations) : 1;
      return animation.playState === "running" && Number.isFinite(iterations);
    });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function rowRects(page: Page, selector: string, count = 2) {
  await settle(page);
  return page.evaluate(
    ({ selector, count }) => {
      return Array.from(document.querySelectorAll(selector))
        .slice(0, count)
        .map((row) => {
          const rect = row.getBoundingClientRect();
          return { y: Math.round(rect.y), height: Math.round(rect.height) };
        });
    },
    { selector, count },
  );
}

function expectSameHeight(loading: Array<{ y: number; height: number }>, loaded: Array<{ y: number; height: number }>) {
  expect(loaded).toHaveLength(loading.length);
  for (let index = 0; index < loading.length; index += 1) {
    expect(
      Math.abs(loaded[index].height - loading[index].height),
      `row ${index} height`,
    ).toBeLessThanOrEqual(1);
  }
}

function expectSameFootprint(loading: Array<{ y: number; height: number }>, loaded: Array<{ y: number; height: number }>) {
  expectSameHeight(loading, loaded);
  for (let index = 0; index < loading.length; index += 1) {
    expect(Math.abs(loaded[index].y - loading[index].y), `row ${index} y`).toBeLessThanOrEqual(1);
  }
}

function expectSamePitch(loading: Array<{ y: number; height: number }>, loaded: Array<{ y: number; height: number }>) {
  for (let index = 1; index < loading.length; index += 1) {
    expect(
      Math.abs(
        (loaded[index].y - loaded[index - 1].y) - (loading[index].y - loading[index - 1].y),
      ),
      `row ${index} pitch`,
    ).toBeLessThanOrEqual(1);
  }
}

async function mockAuthUser(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "owner-1", name: "관리자", role: "owner" }),
    });
  });
}

test.describe("list skeleton parity", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("prices rows keep their height and pitch", async ({ page }) => {
    test.setTimeout(180_000);
    let releaseYears: () => void = () => {};
    let releaseRows: () => void = () => {};
    const yearsReady = new Promise<void>((resolve) => (releaseYears = resolve));
    const rowsReady = new Promise<void>((resolve) => (releaseRows = resolve));

    await mockAuthUser(page);
    await page.route(
      (url) => url.pathname === "/api/voucher-price-infos/years",
      async (route) => {
        await yearsReady;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([2026]) });
      },
    );
    await page.route(
      (url) => url.pathname === "/api/voucher-price-infos/type",
      async (route) => {
        await rowsReady;
        const type = new URL(route.request().url()).searchParams.get("type") ?? "A통합-1형";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, type, duration: "10", fullPrice: "2196000", grant: "1734000", actualPrice: "462000" },
            { id: 2, type, duration: "15", fullPrice: "2500000", grant: "1900000", actualPrice: "600000" },
          ]),
        });
      },
    );

    await page.goto("/prices", { waitUntil: "domcontentloaded", timeout: 120_000 });
    releaseYears();

    const body = "mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body";
    await expect(page.locator(`[data-component="${body}_rows-skeleton_row"]`).first()).toBeVisible({ timeout: 60_000 });
    const loading = await rowRects(page, `[data-component="${body}"] .list-item`);

    releaseRows();
    await expect(page.locator(`[data-component="${body}_variant_section_row"]`).first()).toBeVisible();
    await expect(page.locator(`[data-component="${body}_rows-skeleton_row"]`)).toHaveCount(0);
    const loaded = await rowRects(page, `[data-component="${body}"] .list-item`);

    // Group headers appear above the rows, so absolute y is not comparable;
    // what must not change is the row box and the distance between rows.
    expectSameHeight(loading, loaded);
    expectSamePitch(loading, loaded);
  });

  test("employee doc panels keep their footprint", async ({ page }) => {
    test.setTimeout(180_000);
    let releaseList: () => void = () => {};
    let releaseClients: () => void = () => {};
    let releaseHistory: () => void = () => {};
    const listReady = new Promise<void>((resolve) => (releaseList = resolve));
    const clientsReady = new Promise<void>((resolve) => (releaseClients = resolve));
    const historyReady = new Promise<void>((resolve) => (releaseHistory = resolve));

    await mockAuthUser(page);
    await page.route(
      (url) => url.pathname === "/api/employees",
      async (route) => {
        await listReady;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, name: "김제공", workArea: ["Seogu"], phone: "01012341234", grade: "1급", openToNextWork: true, registeredDate: "2025-01-01", status: "available" },
          ]),
        });
      },
    );
    await page.route(
      (url) => /\/api\/employees\/\d+\/active-clients$/.test(url.pathname),
      async (route) => {
        await clientsReady;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { clientId: 101, clientName: "고객하나", role: "primary", startDate: "2026-01-05", endDate: "2026-02-05", serviceStatus: "진행중" },
            { clientId: 102, clientName: "고객둘", role: "secondary", startDate: "2026-02-05", endDate: "2026-03-05", serviceStatus: "진행중" },
          ]),
        });
      },
    );
    await page.route(
      (url) => /\/api\/employees\/\d+\/work-history$/.test(url.pathname),
      async (route) => {
        await historyReady;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              { scheduleId: 201, clientId: 201, clientName: "고객셋", role: "primary", startDate: "2025-01-01", endDate: "2025-02-01", status: "completed" },
              { scheduleId: 202, clientId: 202, clientName: "고객넷", role: "secondary", startDate: "2025-03-01", endDate: "2025-04-01", status: "replaced" },
            ],
            total: 2,
            page: 1,
            limit: 20,
            totalPages: 1,
          }),
        });
      },
    );

    await page.goto("/employees", { waitUntil: "domcontentloaded", timeout: 120_000 });
    releaseList();

    const listRow = '[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]';
    await expect(page.locator(listRow).first()).toBeVisible({ timeout: 60_000 });
    await page.locator(listRow).first().click();

    const card3 = '[data-component="mobile_employees_detail-panel_info-card-3"]';
    const card4 = '[data-component="mobile_employees_detail-panel_info-card-4"]';

    await page.getByRole("button", { name: "담당 고객" }).click();
    await expect(page.locator(`${card3} .doc-row`).first()).toBeVisible();
    const clientsLoading = await rowRects(page, `${card3} .doc-row`);

    await page.getByRole("button", { name: "근무 내역" }).click();
    await expect(page.locator(`${card4} .doc-row`).first()).toBeVisible();
    const historyLoading = await rowRects(page, `${card4} .doc-row`);

    releaseClients();
    releaseHistory();
    await expect(page.locator('[data-component="mobile_employees_detail-panel_info-card-4_loading_row"]')).toHaveCount(0);

    const historyLoaded = await rowRects(page, `${card4} .doc-row`);
    await page.getByRole("button", { name: "담당 고객" }).click();
    await expect(page.locator('[data-component="mobile_employees_detail-panel_info-card-3_clients-loading_row"]')).toHaveCount(0);
    const clientsLoaded = await rowRects(page, `${card3} .doc-row`);

    expectSameFootprint(clientsLoading, clientsLoaded);
    expectSameFootprint(historyLoading, historyLoaded);
  });

  test("message settings rows keep their footprint", async ({ page }) => {
    test.setTimeout(180_000);
    let releaseApproval: () => void = () => {};
    let releasePolicies: () => void = () => {};
    const approvalReady = new Promise<void>((resolve) => (releaseApproval = resolve));
    const policiesReady = new Promise<void>((resolve) => (releasePolicies = resolve));

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
    await page.route("**/api/settings/message-automation-policies**", async (route) => {
      await policiesReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          policies: [
            {
              id: "trigger-dispatch",
              title: "자동 전송 실행",
              description: "등록된 자동 전송 규칙을 실행합니다.",
              active: true,
              requiresApproval: true,
              rows: [{ id: "status", label: "상태", value: "활성" }],
            },
            {
              id: "client-registration",
              title: "고객 등록",
              description: "신규 고객을 자동 등록합니다.",
              active: true,
              requiresApproval: true,
              rows: [{ id: "status", label: "상태", value: "활성" }],
            },
          ],
        }),
      });
    });

    await page.goto("/messages/settings", { waitUntil: "domcontentloaded", timeout: 120_000 });

    const container = '[data-component$="_settings-list_items"]';
    await expect(page.locator('[data-source-component="SettingsRowsSkeleton"]').first()).toBeVisible({ timeout: 60_000 });
    const loading = await rowRects(page, `${container} > div`);

    releaseApproval();
    releasePolicies();
    await expect(page.locator('[data-source-component="SettingsRowsSkeleton"]')).toHaveCount(0);
    await expect(page.locator(`${container} > div > button`).first()).toBeVisible();
    const loaded = await rowRects(page, `${container} > div`);

    expectSameFootprint(loading, loaded);
  });

  test("dashboard rows keep their footprint", async ({ page }) => {
    test.setTimeout(180_000);
    let releaseClients: () => void = () => {};
    const clientsReady = new Promise<void>((resolve) => (releaseClients = resolve));

    const day = 24 * 60 * 60 * 1000;
    const baseClient = {
      createdAt: null,
      updatedAt: null,
      birthday: null,
      dueDate: null,
      birthDate: null,
      address: "인천",
      phone: "01099990000",
      primaryEmployee: null,
      secondaryEmployee: null,
      type: "A통합-2형",
      duration: 10,
      fullPrice: "2196000",
      grant: "1734000",
      actualPrice: "462000",
      careCenter: false,
      voucherClient: false,
      breastPump: false,
      eDocId: null,
      areaId: "Seogu",
      hasSigned: false,
      documentStatus: null,
    };
    const clients = [
      {
        ...baseClient,
        id: 1,
        name: "조치고객",
        actionRequired: true,
        serviceStatus: null,
        startDate: null,
        endDate: null,
      },
      {
        ...baseClient,
        id: 2,
        name: "시작고객",
        actionRequired: false,
        serviceStatus: null,
        startDate: new Date(Date.now() + 3 * day).toISOString(),
        endDate: null,
      },
      {
        ...baseClient,
        id: 3,
        name: "종료고객",
        actionRequired: false,
        serviceStatus: "active",
        startDate: null,
        endDate: new Date(Date.now() + 14 * day).toISOString(),
      },
    ];

    await mockAuthUser(page);
    await page.route(
      (url) => url.pathname === "/api/clients/analytics",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ activeClients: 0, upcomingThisMonth: 0, contractsPendingSignature: 0, contractsNotSent: 0 }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === "/api/clients",
      async (route) => {
        await clientsReady;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: clients, total: clients.length, page: 1, limit: 50, totalPages: 1 }),
        });
      },
    );

    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 120_000 });

    const body = "mobile_dashboard_page_content_list-card_body";
    await expect(page.locator(`[data-component="${body}_loading-skeleton_row"]`).first()).toBeVisible({ timeout: 60_000 });
    const loading = await rowRects(page, `[data-component="${body}"] .list-item`);

    releaseClients();
    await expect(page.locator(`[data-component="${body}_loading-skeleton_row"]`)).toHaveCount(0);
    await expect(page.locator(`[data-component="${body}"] .list-item`).first()).toBeVisible();
    const loaded = await rowRects(page, `[data-component="${body}"] .list-item`);

    expectSameFootprint(loading, loaded);
  });
});
