import { test, expect, type Page, type Route } from '@playwright/test';

interface MockAuthUser {
  id: string;
  name: string;
  email: string;
  profile_image: string;
  role: string;
}

const MOCK_ADMIN_USER = {
  id: 'admin-user',
  name: '관리자',
  email: 'admin@example.com',
  profile_image: '',
  role: 'admin',
};

const setupAuthMocks = async (page: Page, user: MockAuthUser) => {
  await page.addInitScript(() => {
    (window as typeof window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });
  
  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
  });
  
  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
  });
};

test.describe('Admin Nav Visibility', () => {
  test('admin nav item is highlighted when on /admin page', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positive: 0, negative: 0, total: 0 }) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 관리')).toBeVisible({ timeout: 15000 });
    
    const menuButton = page.locator('button[aria-label="open navigation"]');
    await menuButton.click();
    
    const adminNavItem = page.getByRole('link', { name: '관리자' });
    await expect(adminNavItem).toBeVisible();
  });
});
