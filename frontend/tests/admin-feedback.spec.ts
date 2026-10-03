import { test, expect, type Page, type Route } from '@playwright/test';

// Mock for admin user
const MOCK_ADMIN_USER = {
  id: 'admin-user',
  name: '관리자',
  email: 'admin@example.com',
  profile_image: '',
  role: 'admin',
};

// Mock feedback data
const MOCK_FEEDBACK_LIST = {
  data: [
    {
      id: 'feedback-1',
      type: 'positive',
      comment: null,
      createdAt: '2024-01-15T10:00:00.000Z',
      user: { id: 'user-1', name: '홍길동', email: 'hong@example.com' },
      message: { id: 'msg-1', content: '답변 내용입니다', role: 'assistant', timestamp: '2024-01-15T09:59:00.000Z' },
    },
    {
      id: 'feedback-2',
      type: 'negative',
      comment: '답변이 부정확합니다',
      createdAt: '2024-01-15T11:00:00.000Z',
      user: { id: 'user-2', name: '김철수', email: 'kim@example.com' },
      message: { id: 'msg-2', content: '다른 답변입니다', role: 'assistant', timestamp: '2024-01-15T10:59:00.000Z' },
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const MOCK_FEEDBACK_STATS = {
  positive: 10,
  negative: 5,
  total: 15,
};

// Helper to setup auth mocks
type MockUser = typeof MOCK_ADMIN_USER;

const setupAuthMocks = async (page: Page, user: MockUser) => {
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

test.describe('Admin Feedback Page', () => {
  test('admin user can access /admin page', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Should see the feedback list panel with the mocked rows
    await expect(page.getByRole('heading', { name: '피드백 목록' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('홍길동')).toBeVisible();
  });

  test('filter tabs work correctly', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    let lastUrl = '';
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      lastUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Click negative filter
    await page.getByRole('button', { name: '부정적' }).click();
    await page.waitForTimeout(500);
    
    expect(lastUrl).toContain('type=negative');
  });

  test('displays feedback stats correctly', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // The stats bar renders one stat per label, value first.
    const stat = (label: string) => page
      .locator('[data-slot="stat-mini-content"]')
      .filter({ has: page.locator('[data-slot="stat-mini-label"]', { hasText: label }) });
    await expect(stat('전체')).toContainText('15');
    await expect(stat('긍정적')).toContainText('10');
    await expect(stat('부정적')).toContainText('5');
  });

  test('displays feedback list with correct data', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Feedback rows: user name as the title, the comment as the subtitle.
    await expect(page.getByRole('heading', { name: '피드백 목록' })).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('답변이 부정확합니다')).toBeVisible();

    // Nothing is selected yet, so the detail panel shows its placeholder.
    await expect(page.getByText('피드백을 선택하면 상세 정보가 표시됩니다')).toBeVisible();

    // Selecting a row opens the detail panel with that feedback's info card.
    await page.route('**/api/admin/feedback/feedback-2', async (route) => {
      const feedback = MOCK_FEEDBACK_LIST.data[1];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...feedback,
          session: { id: 'session-1', messages: [feedback.message] },
        }),
      });
    });
    await page.getByText('김철수').click();
    const detail = page.locator('[data-component="desktop_admin_split-layout_detail-panel"]');
    await expect(detail.getByText('부정적 피드백')).toBeVisible();
    await expect(detail.getByText('피드백 정보')).toBeVisible();
    await expect(detail.getByText('답변이 부정확합니다')).toBeVisible();
    await expect(detail.getByText('다른 답변입니다')).toBeVisible();
  });

  test('shows empty state when no feedback exists', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positive: 0, negative: 0, total: 0 }) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    await expect(page.getByText('피드백이 없습니다')).toBeVisible();
  });

  test('positive filter shows only positive feedback', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    let lastUrl = '';
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      lastUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Click positive filter
    await page.getByRole('button', { name: '긍정적' }).click();
    await page.waitForTimeout(500);
    
    expect(lastUrl).toContain('type=positive');
  });

  test('owner user can access /admin page', async ({ page }) => {
    const MOCK_OWNER_USER = { ...MOCK_ADMIN_USER, role: 'owner' };
    await setupAuthMocks(page, MOCK_OWNER_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Should see the feedback list
    await expect(page.getByRole('heading', { name: '피드백 목록' })).toBeVisible({ timeout: 5000 });
  });
});
