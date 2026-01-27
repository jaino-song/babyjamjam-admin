import { test, expect } from '@playwright/test';

// Clear sessionStorage before each test to prevent auth caching
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
  });
});

const MOCK_DOCUMENTS = {
  documents: [
    {
      id: 'doc-1',
      created_date: Date.now(),
      current_status: {
        status_type: 'doc_complete',
        step_recipients: [{ name: '홍길동' }],
      },
      last_editor: { name: '홍길동' },
      creator: { name: '관리자' },
    },
    {
      id: 'doc-2',
      created_date: Date.now() - 86400000,
      current_status: {
        status_type: 'doc_request_participant',
        step_recipients: [{ name: '김철수' }],
      },
      last_editor: null,
      creator: { name: '관리자' },
    },
  ],
};

const MOCK_EMPTY_DOCUMENTS = { documents: [] };

const MOCK_MANY_DOCUMENTS = {
  documents: Array.from({ length: 10 }, (_, i) => ({
    id: `doc-${i + 1}`,
    created_date: Date.now() - i * 86400000,
    current_status: {
      status_type: i % 2 === 0 ? 'doc_complete' : 'doc_request_participant',
      step_recipients: [{ name: `고객${i + 1}` }],
    },
    last_editor: { name: `고객${i + 1}` },
    creator: { name: '관리자' },
  })),
};

test.describe('Contracts Page Skeleton Loading', () => {
  test.describe('Initial Loading State', () => {
    test('should display skeleton rows during initial page load', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      await expect(page.locator('.MuiSkeleton-root').first()).toBeVisible({ timeout: 1000 });
      await expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible();
      await expect(page.locator('thead th')).toHaveCount(3);
    });

    test('should show table headers and toolbar immediately on page load', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      await expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible({ timeout: 500 });
      await expect(page.locator('thead')).toBeVisible({ timeout: 500 });
    });

    test('should show 5 skeleton rows matching rowsPerPage', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      const skeletonRows = page.locator('tbody tr').filter({ has: page.locator('.MuiSkeleton-root') });
      await expect(skeletonRows).toHaveCount(5, { timeout: 500 });
    });
  });

  test.describe('Data Loading Complete', () => {
    test.beforeEach(async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });
    });

    test('should replace skeleton rows with actual data when loading completes', async ({ page }) => {
      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();
      await expect(page.locator('tbody').getByText('홍길동')).toBeVisible();
    });

    test('should enable pagination after data loads', async ({ page }) => {
      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.MuiTablePagination-root')).toBeVisible();
    });
  });

  test.describe('Filter Changes', () => {
    test('should allow selecting different filters', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.route('**/api/documents/completed', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('tbody').getByText('홍길동')).toBeVisible();

      const filterButton = page.locator('[data-component="documents-list-toolbar-buttons"]').locator('button').nth(1);
      await filterButton.click();

      await page.locator('[role="menuitem"]').filter({ hasText: '완료' }).click();

      await page.waitForLoadState('networkidle');
      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();
      
      const filterChip = page.locator('[data-component="documents-list-toolbar-buttons"]').locator('.MuiChip-root');
      await expect(filterChip).toContainText('완료');
    });
  });

  test.describe('Error States', () => {
    test('should display error alert when auth API fails', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Auth failed' }),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      const muiAlert = page.locator('.MuiAlert-root');
      await expect(muiAlert).toBeVisible();
      await expect(muiAlert).toContainText('인증에 실패했습니다');
    });

    test('should display error alert when documents API fails', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Documents fetch failed' }),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      const muiAlert = page.locator('.MuiAlert-root');
      await expect(muiAlert).toBeVisible();
    });
  });

  test.describe('Empty State', () => {
    test('should display "no documents" alert when data is empty', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_EMPTY_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();
      const muiAlert = page.locator('.MuiAlert-root');
      await expect(muiAlert).toBeVisible();
      await expect(muiAlert).toContainText('문서가 없습니다');
    });
  });

  test.describe('Pagination During Loading', () => {
    test('should show pagination disabled during initial loading', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MANY_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      await expect(page.locator('.MuiTablePagination-root')).toBeVisible({ timeout: 500 });

      const prevButton = page.locator('.MuiTablePagination-actions button').first();
      const nextButton = page.locator('.MuiTablePagination-actions button').last();

      await expect(prevButton).toBeDisabled();
      await expect(nextButton).toBeDisabled();
    });

    test('should enable pagination buttons after data loads with multiple pages', async ({ page }) => {
      await page.route('**/api/access-token', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route('**/api/documents**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MANY_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.MuiTablePagination-root')).toBeVisible();

      const nextButton = page.locator('.MuiTablePagination-actions button').last();
      await expect(nextButton).toBeEnabled();
    });
  });
});
