import { expect, type Locator } from "@playwright/test";

/** Assert the initial fit + one peek window using the uncompressed row height. */
export async function expectMeasuredInitialRows(
  scrollContainer: Locator,
  totalItems: number,
): Promise<number> {
  const rows = scrollContainer.locator(".list-item");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await expect(rows.first()).toHaveCSS("flex-shrink", "0");

  const { height, rowHeight, gap, padding } = await scrollContainer.evaluate((container) => {
    const row = container.querySelector<HTMLElement>(".list-item");
    if (!row) throw new Error("Expected a rendered list row before measuring");
    const style = getComputedStyle(container);
    return {
      height: container.clientHeight,
      rowHeight: row.offsetHeight,
      gap: parseFloat(style.rowGap || style.gap) || 0,
      padding: (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0),
    };
  });
  expect(height).toBeGreaterThan(padding);
  expect(rowHeight).toBeGreaterThan(0);
  const fit = Math.max(1, Math.floor((height - padding + gap) / (rowHeight + gap)));
  const expectedCount = Math.min(totalItems, fit + 1);
  await expect(rows).toHaveCount(expectedCount);
  return expectedCount;
}
