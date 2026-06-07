import { expect, test, type Page } from '@playwright/test';

const SEARCH_PLACEHOLDER = '고객명, 계약서명, 계약 번호 검색';

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
    {
      id: 'doc-3',
      document_number: 'DOC-003',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길순 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 172_800_000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 172_800_000,
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길순' }],
      },
    },
  ],
  total_rows: 3,
  limit: 100,
  skip: 0,
};

const MOCK_EMPTY_DOCUMENTS = {
  documents: [],
  total_rows: 0,
  limit: 100,
  skip: 0,
};

async function routeContractsList(page: Page, payload = MOCK_DOCUMENTS): Promise<void> {
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
      body: JSON.stringify(payload),
    });
  });

  await page.route('**/api/eformsign-docs/client-names**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        payload.documents.map((doc, index) => ({
          documentId: doc.id,
          clientId: 1000 + index,
          clientName: doc.current_status?.step_recipients?.[0]?.name ?? doc.document_name,
          clientPhone: '010-0000-0000',
          providerName: '테스트 제공인력',
        })),
      ),
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

test.describe('Contracts Page Search Feature', () => {
  test('renders the current mobile search and filter shell', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-component="mobile-contracts-search"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-filter-row"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-list-action"]')).toContainText(
      '계약 작성',
    );
  });

  test('filters contract rows by customer name as the query changes', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    const searchField = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(searchField).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();

    await searchField.fill('홍길');

    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
    await expect(page.getByText('김철수')).not.toBeVisible();
  });

  test('restores the full list when the search query is cleared', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    const searchField = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(searchField).toBeVisible({ timeout: 15000 });

    await searchField.fill('홍길동');
    await expect(page.getByText('김철수')).not.toBeVisible();

    await searchField.clear();

    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
  });

  test('applies the completed filter via the mobile filter pills', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });

    const completedFilter = page
      .locator('[data-component="mobile-redesign-filter-pill"]')
      .filter({ hasText: '완료' });
    await completedFilter.click();

    await expect(completedFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
    await expect(page.getByText('김철수')).not.toBeVisible();
  });

  test('shows the current empty-state copy when no contracts match', async ({ page }) => {
    await routeContractsList(page, MOCK_EMPTY_DOCUMENTS);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-component="mobile-contracts-empty"]')).toContainText(
      '등록된 계약서가 없습니다.',
    );
  });
});
