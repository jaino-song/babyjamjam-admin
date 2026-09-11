import { expect, type Page, test } from "@playwright/test";

// Pins the reported regression: the client list skeleton rows must match the
// loaded rows' geometry, or the list visibly jumps as the data arrives.
const BODY = "mobile_clients_detail-sheet_stack_list-page_content_list-card_body";
const SKELETON_ROW = `[data-component="${BODY}_rows-skeleton_row"]`;
const LOADED_ROW = `[data-component="${BODY}_section_row"]`;
const ROW = `[data-component="${BODY}"] .list-item`;
const FILTER_PILL = '[data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_filters"] button';

const CLIENTS = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  name: `고객${i + 1}`,
  createdAt: null,
  updatedAt: null,
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: "인천",
  phone: `0109999000${i}`,
  primaryEmployee: null,
  secondaryEmployee: null,
  type: "A통합-2형",
  duration: 10,
  fullPrice: "2196000",
  grant: "1734000",
  actualPrice: "462000",
  startDate: "2026-06-10T00:00:00.000Z",
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  areaId: "Seogu",
  hasSigned: false,
  documentStatus: null,
}));

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Only finite animations: the skeleton pulse loops forever.
    const animations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming?.();
      const iterations = timing ? Number(timing.iterations) : 1;
      return animation.playState === "running" && Number.isFinite(iterations);
    });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function measureRows(page: Page) {
  await settle(page);
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector))
      .slice(0, 3)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return { y: Math.round(rect.y), height: Math.round(rect.height) };
      });
  }, ROW);
}

async function measureFilterPills(page: Page) {
  await settle(page);
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector))
      .slice(0, 4)
      .map((pill) => {
        const rect = pill.getBoundingClientRect();
        return { x: Math.round(rect.x), width: Math.round(rect.width) };
      });
  }, FILTER_PILL);
}

test.describe("Mobile client list skeleton geometry", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the row grid identical when the client data lands", async ({ page }) => {
    test.setTimeout(180_000);

    let releaseClients: () => void = () => {};
    const clientsReady = new Promise<void>((resolve) => {
      releaseClients = resolve;
    });

    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "owner-1", name: "관리자", role: "owner" }),
      });
    });
    await page.route("**/api/clients**", async (route) => {
      await clientsReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: CLIENTS,
          total: CLIENTS.length,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      });
    });

    await page.goto("/clients", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await expect(page.locator(SKELETON_ROW).first()).toBeVisible({ timeout: 60_000 });

    const skeletonRows = await measureRows(page);
    expect(skeletonRows).toHaveLength(3);
    const skeletonPills = await measureFilterPills(page);

    releaseClients();

    await expect(page.locator(LOADED_ROW).first()).toBeVisible();
    await expect(page.locator(SKELETON_ROW)).toHaveCount(0);

    const loadedRows = await measureRows(page);
    expect(loadedRows).toHaveLength(3);
    const loadedPills = await measureFilterPills(page);

    // Each row keeps its exact line: a 2px pitch drift accumulates into a
    // visible jump by the bottom of the viewport.
    for (let index = 0; index < 3; index += 1) {
      expect(
        Math.abs(loadedRows[index].y - skeletonRows[index].y),
        `row ${index} y`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(loadedRows[index].height - skeletonRows[index].height),
        `row ${index} height`,
      ).toBeLessThanOrEqual(1);
    }

    // The filter pills reserve the same 2-digit count slot while loading, so a
    // single-digit loaded count must not slide the pill row horizontally.
    expect(skeletonPills.length).toBeGreaterThan(0);
    expect(loadedPills).toHaveLength(skeletonPills.length);
    for (let index = 0; index < skeletonPills.length; index += 1) {
      expect(
        Math.abs(loadedPills[index].x - skeletonPills[index].x),
        `pill ${index} x`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(loadedPills[index].width - skeletonPills[index].width),
        `pill ${index} width`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
