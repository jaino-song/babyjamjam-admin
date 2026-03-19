import { test as base } from "@playwright/test";

import { mobileScreenshotRoutes } from "./route-manifest";

const publicTest = base.extend({
  storageState: async ({}, applyStorageState) => {
    await applyStorageState(undefined);
  },
});

const authenticatedRoutes = mobileScreenshotRoutes.filter((route) => route.auth === "authenticated");
const publicRoutes = mobileScreenshotRoutes.filter((route) => route.auth === "public");

const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
} as const;

for (const [viewportName, viewportSize] of Object.entries(viewports)) {
  base.describe(`authenticated ${viewportName}`, () => {
    base.use({ viewport: viewportSize });

    for (const route of authenticatedRoutes) {
      base(`capture ${route.slug}`, async ({ page }) => {
        await page.goto(route.path);
        await page.waitForLoadState("networkidle", { timeout: 15000 });

        await page.screenshot({
          path: `tests/screenshots/baseline/${viewportName}/authenticated-${route.slug}.png`,
          fullPage: true,
        });
      });
    }
  });

  publicTest.describe(`public ${viewportName}`, () => {
    publicTest.use({ viewport: viewportSize });

    for (const route of publicRoutes) {
      publicTest(`capture ${route.slug}`, async ({ page }) => {
        await page.goto(route.path);
        await page.waitForLoadState("networkidle", { timeout: 15000 });

        await page.screenshot({
          path: `tests/screenshots/baseline/${viewportName}/public-${route.slug}.png`,
          fullPage: true,
        });
      });
    }
  });
}
