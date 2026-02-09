import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __v3AnimEvents?: Array<{ name: string; comp: string | null; t: number }>;
  }
}

test.describe("Dashboard activities animations", () => {
  test("does not re-run intro/list animations when stats loading completes", async ({ page }) => {
    // Collect only our v3 animations; ignore Skeleton's "pulse" etc.
    await page.addInitScript(() => {
      window.__v3AnimEvents = [];
      document.addEventListener(
        "animationstart",
        (e) => {
          const animName = (e as AnimationEvent).animationName || "";
          if (!animName.startsWith("v3-")) return;
          const target = e.target as HTMLElement | null;
          const comp = target?.dataset?.component ?? null;
          window.__v3AnimEvents?.push({ name: animName, comp, t: performance.now() });
        },
        true
      );
    });

    // Delay stats so intro animations can start before loading resolves.
    await page.route("**/api/clients/stats", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activeClients: 1,
          contractsNotSent: 2,
          contractsPendingSignature: 3,
          upcomingThisMonth: 4,
          upcomingNextMonth: 5,
        }),
      });
    });

    const statsResponse = page.waitForResponse("**/api/clients/stats");
    await page.goto("/dashboard");

    const panel = page.locator('[data-component="dashboard-activities-panel"]');
    await expect(panel).toBeVisible();

    // While loading, we show 4 skeleton list items.
    await expect(page.locator('[data-component="dashboard-split-list-item"]')).toHaveCount(4);

    // Wait long enough for the component-level row animations to start (independent of data fetching).
    await page.waitForTimeout(400);
    const beforeResolve = await page.evaluate(() => window.__v3AnimEvents ?? []);
    const initialPopUps = beforeResolve.filter(
      (e) => e.name === "v3-pop-up" && e.comp === "dashboard-split-list-item"
    );
    expect(initialPopUps.length).toBe(4);

    // After stats resolves, skeletons are replaced by real items.
    await statsResponse;
    // Wait for the icon container to switch away from the skeleton color.
    await page.waitForFunction(() => {
      const firstIcon = document.querySelector(
        '[data-component="dashboard-split-list-item-icon"]'
      ) as HTMLElement | null;
      if (!firstIcon) return false;
      return !firstIcon.className.includes("bg-v3-dim-white");
    });
    await page.waitForTimeout(300);
    const afterResolve = await page.evaluate(() => window.__v3AnimEvents ?? []);

    // The activities panel may animate on first paint (page-level intro),
    // but it must not re-animate when the stats request resolves.
    const panelBefore = beforeResolve.filter((e) => e.comp === "dashboard-activities-panel").length;
    const panelAfter = afterResolve.filter((e) => e.comp === "dashboard-activities-panel").length;
    expect(panelAfter).toBe(panelBefore);

    // After loading resolves, the activity rows should "pop up" once (4 items on the "all" tab).
    const popUpsAfterResolve = afterResolve
      .slice(beforeResolve.length)
      .filter((e) => e.name === "v3-pop-up" && e.comp === "dashboard-split-list-item");
    expect(popUpsAfterResolve.length).toBe(0);

    // And it must not keep re-animating on subsequent UI interactions (e.g. switching tabs).
    await page.getByRole("button", { name: "고객" }).click();
    await page.waitForTimeout(250);
    const afterTab = await page.evaluate(() => window.__v3AnimEvents ?? []);
    expect(afterTab.length).toBe(afterResolve.length);
  });
});
