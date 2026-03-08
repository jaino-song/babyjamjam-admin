import { test as base } from '@playwright/test';

const test = base.extend({
  storageState: async (_args, runStorageState) => {
    // Override storageState to empty since auth.json doesn't exist
    await runStorageState(undefined);
  }
});

const pages = ['dashboard', 'clients', 'settings', 'messages', 'contracts'];
const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 }
};

for (const [viewportName, viewportSize] of Object.entries(viewports)) {
  test.describe(`${viewportName} viewport`, () => {
    test.use({ ...viewportSize });
    
    for (const pageName of pages) {
      test(`capture ${pageName}`, async ({ page }) => {
        const url = pageName === 'dashboard' ? '/' : `/${pageName}`;
        await page.goto(url);
        
        // Wait for page to be fully loaded
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        
        // Take full page screenshot
        const filename = `${pageName}-${viewportName}.png`;
        await page.screenshot({
          path: `tests/screenshots/baseline/${filename}`,
          fullPage: true
        });
      });
    }
  });
}
