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
      document_number: 'DOC-001',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길동 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now(),
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now(),
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길동' }],
      },
    },
    {
      id: 'doc-2',
      document_number: 'DOC-002',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '김철수 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 86400000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 86400000,
      current_status: {
        status_type: '002',
        step_recipients: [{ recipient_type: 'signer', name: '김철수' }],
      },
    },
    {
      id: 'doc-3',
      document_number: 'DOC-003',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길순 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 172800000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 172800000,
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길순' }],
      },
    },
  ],
  total_rows: 3,
  limit: 20,
  skip: 0,
};

const MOCK_COMPLETED_DOCUMENTS = {
  documents: [
    {
      id: 'doc-1',
      document_number: 'DOC-001',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길동 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now(),
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now(),
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길동' }],
      },
    },
    {
      id: 'doc-4',
      document_number: 'DOC-004',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '김철수 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 86400000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 86400000,
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '김철수' }],
      },
    },
  ],
  total_rows: 2,
  limit: 20,
  skip: 0,
};

const MOCK_MANY_DOCUMENTS = {
  documents: Array.from({ length: 12 }, (_, i) => ({
    id: `doc-${i + 1}`,
    document_number: `DOC-${String(i + 1).padStart(3, '0')}`,
    template: { id: 'tpl-1', name: 'Contract' },
    document_name: `고객${i + 1} 계약서`,
    creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
    created_date: Date.now() - i * 86400000,
    last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
    updated_date: Date.now() - i * 86400000,
    current_status: {
      status_type: i % 2 === 0 ? '003' : '002',
      step_recipients: [{ recipient_type: 'signer', name: `고객${i + 1}` }],
    },
  })),
  total_rows: 12,
  limit: 20,
  skip: 0,
};

test.describe('Contracts Page Search Feature', () => {
  test.describe('Search UI Visibility', () => {
    test('should display search icon initially (collapsed state)', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Verify toolbar is visible
      await expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible();

      // Verify search icon is visible but TextField is NOT visible initially
      const searchIconButton = page.getByRole('button', { name: /search/i });
      await expect(searchIconButton).toBeVisible();
      await expect(page.getByPlaceholder('고객명 검색')).not.toBeVisible();
    });

    test('should expand search TextField when icon is clicked', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Click search icon to expand
      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      // Verify TextField is now visible
      await expect(page.getByPlaceholder('고객명 검색')).toBeVisible();
    });
  });

  test.describe('Search Functionality', () => {
    test('should filter documents when user types and presses Enter', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).toBeVisible();
      await expect(page.getByText('홍길순')).toBeVisible();

      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('홍길');
      await page.keyboard.press('Enter');

      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('홍길순')).toBeVisible();
      await expect(page.getByText('김철수')).not.toBeVisible();
    });

    test('should filter documents when user presses Enter in search field', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).toBeVisible();

      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('김철수');
      await page.keyboard.press('Enter');

      await expect(page.getByText('김철수')).toBeVisible();
      await expect(page.getByText('홍길동')).not.toBeVisible();
    });

    test('should show all documents when search is cleared', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('홍길동');
      await page.keyboard.press('Enter');

      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).not.toBeVisible();

      await searchField.clear();
      await page.keyboard.press('Enter');

      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).toBeVisible();
      await expect(page.getByText('홍길순')).toBeVisible();
    });

    test('should show "문서가 없습니다" when no documents match search', async ({ page }) => {
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

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('박영희');
      await page.keyboard.press('Enter');

      const muiAlert = page.locator('.MuiAlert-root');
      await expect(muiAlert).toBeVisible();
      await expect(muiAlert).toContainText('문서가 없습니다');
    });
  });

  test.describe('Search + Status Filter Combination', () => {
    test('should apply search within status-filtered results', async ({ page }) => {
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
          body: JSON.stringify(MOCK_COMPLETED_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Select '완료' status filter
      const filterButton = page.locator('[data-component="documents-list-toolbar-buttons"]').locator('button').nth(1);
      await filterButton.click();

      await page.locator('[role="menuitem"]').filter({ hasText: '완료' }).click();
      await page.waitForLoadState('networkidle');

      // Verify status filter is applied
      const filterChip = page.locator('[data-component="documents-list-toolbar-buttons"]').locator('.MuiChip-root');
      await expect(filterChip).toContainText('완료');

      // Verify both completed documents are visible
      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).toBeVisible();

      // Click search icon to expand search field
      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      // Apply search within filtered results
      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('홍길동');
      await page.keyboard.press('Enter');

      // Verify only matching document is visible
      await expect(page.getByText('홍길동')).toBeVisible();
      await expect(page.getByText('김철수')).not.toBeVisible();

      // Verify status filter chip is still visible
      await expect(filterChip).toContainText('완료');
    });
  });

  test.describe('Pagination Reset', () => {
    test('should reset to first page when search is executed', async ({ page }) => {
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

      // Navigate to page 2
      const nextButton = page.locator('.MuiTablePagination-actions button').last();
      await nextButton.click();
      await page.waitForTimeout(500);

      // Verify we're on page 2
      const paginationText = page.locator('.MuiTablePagination-displayedRows');
      await expect(paginationText).toContainText('6–10');

      // Click search icon to expand search field
      const searchIconButton = page.getByRole('button', { name: /search/i });
      await searchIconButton.click();

      // Execute search
      const searchField = page.getByPlaceholder('고객명 검색');
      await searchField.fill('고객1');
      await page.keyboard.press('Enter');

      // Verify pagination reset to first page
      await expect(paginationText).toContainText('1–');
    });
  });
});
