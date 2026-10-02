import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Loading, error and empty states of the contracts list.
 *
 * The list is a v3 ListPanel (skeleton cards while loading, infinite scroll instead of table
 * pagination). The page runs on the signed-in session from global-setup because /contracts fetches
 * on the server; the document and eformsign auth endpoints are mocked.
 */

function createDocument(index: number, name: string, statusType: '002' | '003') {
  const createdAt = Date.now() - index * 86_400_000;
  return {
    id: `doc-${index}`,
    document_number: `DOC-${String(index).padStart(3, '0')}`,
    template: { id: 'tpl-1', name: 'Contract' },
    document_name: `${name} 계약서`,
    creator: { recipient_type: 'sender', id: 'admin', name: '관리자' },
    created_date: createdAt,
    last_editor: { recipient_type: 'sender', id: 'admin', name: '관리자' },
    updated_date: createdAt,
    current_status: {
      status_type: statusType,
      step_recipients: [{ recipient_type: 'signer', name }],
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
  };
}

const MOCK_DOCUMENTS = {
  documents: [createDocument(1, '홍길동', '003'), createDocument(2, '김철수', '002')],
  total_rows: 2,
  limit: 20,
  skip: 0,
};
const MOCK_COMPLETED_DOCUMENTS = {
  documents: [createDocument(1, '홍길동', '003')],
  total_rows: 1,
  limit: 20,
  skip: 0,
};
const MOCK_EMPTY_DOCUMENTS = { documents: [], total_rows: 0, limit: 20, skip: 0 };

const LIST = '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel"]';
const LIST_ITEM = '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_list"] > div';

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockEformsignAuth(page: Page, status = 200) {
  await page.route('**/api/eformsign/auth-status', (route) =>
    status === 200
      ? fulfillJson(route, { hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true })
      : fulfillJson(route, { error: 'Auth failed' }, status),
  );
}

async function mockDocuments(
  page: Page,
  handler: (route: Route, pathname: string) => Promise<unknown> | unknown,
) {
  await page.route('**/api/eformsign/documents**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (
      pathname !== '/api/eformsign/documents'
      && !/^\/api\/eformsign\/documents\/(in-progress|completed|expired)$/.test(pathname)
    ) {
      return route.fallback();
    }
    return handler(route, pathname);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('Contracts Page Skeleton Loading', () => {
  test.beforeEach(async ({ page }) => {
    await mockEformsignAuth(page);
  });

  test.describe('Initial Loading State', () => {
    test('shows skeleton cards while the first page loads, with the panel header already visible', async ({ page }) => {
      await mockDocuments(page, async (route) => {
        await delay(1_500);
        await fulfillJson(route, MOCK_DOCUMENTS);
      });

      await page.goto('/contracts');

      // Header, tabs and the search control do not wait for the data.
      await expect(page.getByRole('heading', { name: '계약 목록' })).toBeVisible();
      await expect(page.getByRole('button', { name: '검색 열기' })).toBeVisible();
      await expect(page.locator(`${LIST} [data-slot="skeleton"]`).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /홍길동 계약서/ })).toHaveCount(0);
    });

    test('renders three skeleton rows while loading', async ({ page }) => {
      await mockDocuments(page, async (route) => {
        await delay(1_500);
        await fulfillJson(route, MOCK_DOCUMENTS);
      });

      await page.goto('/contracts');

      await expect(page.locator(LIST_ITEM)).toHaveCount(3);
      await expect(page.locator(LIST_ITEM).first().locator('[data-slot="skeleton"]').first()).toBeVisible();
    });
  });

  test.describe('Data Loading Complete', () => {
    test.beforeEach(async ({ page }) => {
      await mockDocuments(page, (route) => fulfillJson(route, MOCK_DOCUMENTS));
    });

    test('replaces the skeleton rows with the documents when loading completes', async ({ page }) => {
      await page.goto('/contracts');

      await expect(page.getByRole('button', { name: /홍길동 계약서/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /김철수 계약서/ })).toBeVisible();
      await expect(page.locator(`${LIST} [data-slot="skeleton"]`)).toHaveCount(0);
    });
  });

  test.describe('Filter Changes', () => {
    test('shows skeletons while another status tab loads, then its documents', async ({ page }) => {
      await mockDocuments(page, async (route, pathname) => {
        if (pathname.endsWith('/completed')) {
          await delay(1_200);
          return fulfillJson(route, MOCK_COMPLETED_DOCUMENTS);
        }
        return fulfillJson(route, MOCK_DOCUMENTS);
      });

      await page.goto('/contracts');
      await expect(page.getByRole('button', { name: /김철수 계약서/ })).toBeVisible();

      await page.getByRole('button', { name: '완료', exact: true }).click();

      await expect(page.locator(`${LIST} [data-slot="skeleton"]`).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /홍길동 계약서/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /김철수 계약서/ })).toHaveCount(0);
      await expect(page.locator(`${LIST} [data-slot="skeleton"]`)).toHaveCount(0);
    });
  });

  test.describe('Error States', () => {
    test('shows the error banner when eformsign authentication keeps failing', async ({ page }) => {
      // The auth hook retries with exponential backoff (2s + 4s + 8s) before giving up.
      test.setTimeout(60_000);
      await page.unroute('**/api/eformsign/auth-status');
      await mockEformsignAuth(page, 500);

      await page.goto('/contracts');

      await expect(page.locator('[data-component="desktop_contracts_error_banner"]')).toContainText(
        '인증에 실패했어요. 페이지를 새로고침 해 주세요.',
        { timeout: 30_000 },
      );
    });

    test('shows the error banner when the documents request fails', async ({ page }) => {
      await mockDocuments(page, (route) => fulfillJson(route, { error: 'Documents fetch failed' }, 500));

      await page.goto('/contracts');

      await expect(page.locator('[data-component="desktop_contracts_error_banner"]')).toContainText(
        '문서를 불러오는데 실패했어요.',
        { timeout: 20_000 },
      );
    });
  });

  test.describe('Empty State', () => {
    test('shows the empty message when there are no documents', async ({ page }) => {
      await mockDocuments(page, (route) => fulfillJson(route, MOCK_EMPTY_DOCUMENTS));

      await page.goto('/contracts');

      await expect(page.getByText('계약 문서가 없습니다')).toBeVisible();
      await expect(page.locator(`${LIST} [data-slot="skeleton"]`)).toHaveCount(0);
    });
  });
});
