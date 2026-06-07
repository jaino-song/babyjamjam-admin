import { expect, test, type Page } from '@playwright/test';

const FILTER_SKELETON_COUNT = 6;
const LOADING_ROW_COUNT = 9;

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
      created_date: Date.now() - 86_400_000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 86_400_000,
      current_status: {
        status_type: '002',
        step_recipients: [{ recipient_type: 'signer', name: '김철수' }],
      },
    },
  ],
  total_rows: 2,
  limit: 100,
  skip: 0,
};

const MOCK_EMPTY_DOCUMENTS = {
  documents: [],
  total_rows: 0,
  limit: 100,
  skip: 0,
};

async function routeSharedContractDependencies(page: Page): Promise<void> {
  await page.route('**/api/eformsign-docs/client-names**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          documentId: 'doc-1',
          clientId: 1001,
          clientName: '홍길동',
          clientPhone: '010-0000-0001',
          providerName: '테스트 제공인력',
        },
        {
          documentId: 'doc-2',
          clientId: 1002,
          clientName: '김철수',
          clientPhone: '010-0000-0002',
          providerName: '테스트 제공인력',
        },
      ]),
    });
  });

  await page.route('**/api/alimtalk-logs?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

// The contract list rows ([data-component="mobile-contracts-row"]) only mount
// in the mobile layout — at the default desktop viewport the row tree is
// absent (run #7 evidence: page renders, row count stays 0).
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Contracts Page Skeleton Loading', () => {
  test('shows the current mobile loading shell while documents are pending', async ({ page }) => {
    let releaseAuth!: () => void;
    let releaseDocuments!: () => void;
    const authReady = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const documentsReady = new Promise<void>((resolve) => {
      releaseDocuments = resolve;
    });

    await page.route('**/api/access-token', async (route) => {
      await authReady;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/api/eformsign/documents?**', async (route) => {
      await documentsReady;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DOCUMENTS),
      });
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');

    await expect(page.locator('[data-component="mobile-contracts-search"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]')).toHaveCount(
      FILTER_SKELETON_COUNT,
    );
    await expect(page.locator('[data-component="mobile-contracts-loading-row"]')).toHaveCount(
      LOADING_ROW_COUNT,
    );
    await expect(page.locator('[data-component="mobile-contracts-load-more-placeholder"]')).toBeVisible();

    releaseAuth();
    releaseDocuments();

    await expect(page.locator('[data-component="mobile-contracts-row"]')).toHaveCount(2);
    await expect(page.locator('[data-component="mobile-contracts-loading-row"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-component="mobile-contracts-load-more-placeholder"]')).toHaveCount(0);
  });

  test('keeps the search and filter chrome visible after loading completes', async ({ page }) => {
    await page.route('**/api/access-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/api/eformsign/documents?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DOCUMENTS),
      });
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');
    await expect(page.locator('[data-component="mobile-contracts-row"]')).toHaveCount(2, {
      timeout: 15000,
    });

    await expect(page.locator('[data-component="mobile-contracts-search"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-filter-row"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-list-title"]')).toContainText('2건');
  });

  test('shows the current empty-state copy when no contracts exist', async ({ page }) => {
    await page.route('**/api/access-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/api/eformsign/documents?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_EMPTY_DOCUMENTS),
      });
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');
    await expect(page.locator('[data-component="mobile-contracts-empty"]')).toContainText(
      '등록된 계약서가 없습니다.',
      { timeout: 15000 },
    );
  });
});
