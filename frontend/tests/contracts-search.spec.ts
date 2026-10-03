import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Contracts list search.
 *
 * Search is applied by the backend (`search` query parameter, debounced 300ms in the page), so the
 * fake document endpoints below filter by that parameter the way the real ones do and the specs
 * assert both what the user sees and what was requested. The page itself runs on the signed-in
 * session from global-setup (the contracts page fetches on the server, so a fake auth cookie is not enough).
 */

type MockDocument = {
  id: string;
  document_number: string;
  template: { id: string; name: string };
  document_name: string;
  creator: { recipient_type: string; id: string; name: string };
  created_date: number;
  last_editor: { recipient_type: string; id: string; name: string };
  updated_date: number;
  current_status: { status_type: string; step_recipients: Array<{ recipient_type: string; name: string }> };
  fields: [];
  next_status: [];
  previous_status: [];
  histories: [];
};

function createDocument(index: number, name: string, statusType: '002' | '003'): MockDocument {
  const createdAt = Date.now() - index * 86_400_000;
  return {
    id: `doc-${index}`,
    document_number: `DOC-${String(index).padStart(3, '0')}`,
    template: { id: 'tpl-1', name: 'Contract' },
    document_name: `${name} 계약서`,
    creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
    created_date: createdAt,
    last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
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

const IN_PROGRESS_DOCUMENTS = [createDocument(2, '김철수', '002')];
const COMPLETED_DOCUMENTS = [createDocument(1, '홍길동', '003'), createDocument(3, '홍길순', '003')];
const ALL_DOCUMENTS = [COMPLETED_DOCUMENTS[0], IN_PROGRESS_DOCUMENTS[0], COMPLETED_DOCUMENTS[1]];

type DocumentRequest = { path: string; search: string | null; skip: number; limit: number };

/** Fake eformsign list endpoints: `/documents` (전체), `/in-progress`, `/completed`, `/expired`. */
async function mockDocumentEndpoints(
  page: Page,
  options: { all?: MockDocument[]; inProgress?: MockDocument[]; completed?: MockDocument[]; expired?: MockDocument[] } = {},
) {
  const sets: Record<string, MockDocument[]> = {
    '/api/eformsign/documents': options.all ?? ALL_DOCUMENTS,
    '/api/eformsign/documents/in-progress': options.inProgress ?? IN_PROGRESS_DOCUMENTS,
    '/api/eformsign/documents/completed': options.completed ?? COMPLETED_DOCUMENTS,
    '/api/eformsign/documents/expired': options.expired ?? [],
  };
  const requests: DocumentRequest[] = [];

  await page.route('**/api/eformsign/documents**', async (route: Route) => {
    const url = new URL(route.request().url());
    const source = sets[url.pathname];
    if (!source) return route.fallback();

    const search = url.searchParams.get('search');
    const skip = Number(url.searchParams.get('skip') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    requests.push({ path: url.pathname, search, skip, limit });

    const matches = search
      ? source.filter((doc) => doc.document_name.includes(search.trim()))
      : source;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        documents: matches.slice(skip, skip + limit),
        total_rows: matches.length,
        limit,
        skip,
      }),
    });
  });

  return requests;
}

async function mockEformsignAuth(page: Page) {
  await page.route('**/api/eformsign/auth-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true }),
    }),
  );
}

async function openContracts(page: Page) {
  await page.goto('/contracts');
  await expect(page.getByRole('heading', { name: '계약 목록' })).toBeVisible();
}

const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`${name} 계약서`) });

test.describe('Contracts Page Search Feature', () => {
  test.beforeEach(async ({ page }) => {
    await mockEformsignAuth(page);
  });

  test.describe('Search UI Visibility', () => {
    test('shows the search icon first and keeps the field collapsed', async ({ page }) => {
      await mockDocumentEndpoints(page);
      await openContracts(page);

      await expect(page.getByRole('button', { name: '검색 열기' })).toBeVisible();
      await expect(page.getByRole('button', { name: '검색 닫기' })).toHaveCount(0);
    });

    test('expands the search field when the icon is clicked', async ({ page }) => {
      await mockDocumentEndpoints(page);
      await openContracts(page);

      await page.getByRole('button', { name: '검색 열기' }).click();

      await expect(page.getByRole('textbox', { name: '검색어' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: '검색어' })).toBeFocused();
      await expect(page.getByRole('button', { name: '검색 닫기' })).toBeVisible();
    });
  });

  test.describe('Search Functionality', () => {
    test('filters documents by the typed term and sends it to the server', async ({ page }) => {
      const requests = await mockDocumentEndpoints(page);
      await openContracts(page);

      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '김철수')).toBeVisible();
      await expect(row(page, '홍길순')).toBeVisible();

      await page.getByRole('button', { name: '검색 열기' }).click();
      await page.getByRole('textbox', { name: '검색어' }).fill('홍길');

      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '홍길순')).toBeVisible();
      await expect(row(page, '김철수')).toHaveCount(0);
      expect(requests.some((request) => request.path === '/api/eformsign/documents' && request.search === '홍길')).toBe(true);
    });

    test('narrows to a single document for a full name', async ({ page }) => {
      await mockDocumentEndpoints(page);
      await openContracts(page);

      await page.getByRole('button', { name: '검색 열기' }).click();
      await page.getByRole('textbox', { name: '검색어' }).fill('김철수');

      await expect(row(page, '김철수')).toBeVisible();
      await expect(row(page, '홍길동')).toHaveCount(0);
    });

    test('shows all documents again when the search is cleared', async ({ page }) => {
      await mockDocumentEndpoints(page);
      await openContracts(page);

      await page.getByRole('button', { name: '검색 열기' }).click();
      const searchField = page.getByRole('textbox', { name: '검색어' });
      await searchField.fill('홍길동');

      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '김철수')).toHaveCount(0);

      await searchField.clear();

      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '김철수')).toBeVisible();
      await expect(row(page, '홍길순')).toBeVisible();
    });

    test('shows the empty state when no document matches the search', async ({ page }) => {
      await mockDocumentEndpoints(page);
      await openContracts(page);

      await page.getByRole('button', { name: '검색 열기' }).click();
      await page.getByRole('textbox', { name: '검색어' }).fill('박영희');

      await expect(page.getByText('검색 결과가 없습니다')).toBeVisible();
      await expect(row(page, '홍길동')).toHaveCount(0);
    });
  });

  test.describe('Search + Status Filter Combination', () => {
    test('applies the search inside the selected status tab', async ({ page }) => {
      const requests = await mockDocumentEndpoints(page);
      await openContracts(page);

      await page.getByRole('button', { name: '완료', exact: true }).click();
      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '홍길순')).toBeVisible();
      await expect(row(page, '김철수')).toHaveCount(0);

      await page.getByRole('button', { name: '검색 열기' }).click();
      await page.getByRole('textbox', { name: '검색어' }).fill('홍길동');

      await expect(row(page, '홍길동')).toBeVisible();
      await expect(row(page, '홍길순')).toHaveCount(0);
      expect(requests.some((request) => request.path === '/api/eformsign/documents/completed' && request.search === '홍길동')).toBe(true);
      // The status tab keeps its own endpoint; the search did not fall back to the 전체 list.
      await expect(page.getByRole('button', { name: '완료', exact: true })).toBeVisible();
    });
  });

  test.describe('Pagination Reset', () => {
    test('restarts from the first page when the search changes', async ({ page }) => {
      const many = Array.from({ length: 45 }, (_, index) =>
        createDocument(index + 1, `고객${index + 1}`, index % 2 === 0 ? '003' : '002'),
      );
      const requests = await mockDocumentEndpoints(page, { all: many });
      await openContracts(page);

      // Scrolling the list past the first 20 loads page 2 (skip=20).
      await expect(row(page, '고객1')).toBeVisible();
      const list = page.locator('[data-slot="list-panel-content"]').first();
      await expect.poll(async () => {
        await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
        return requests.some((request) => request.skip === 20);
      }).toBe(true);

      await page.getByRole('button', { name: '검색 열기' }).click();
      await page.getByRole('textbox', { name: '검색어' }).fill('고객4');

      await expect.poll(() => requests.find((request) => request.search === '고객4')?.skip).toBe(0);
      await expect(row(page, '고객4')).toBeVisible();
    });
  });
});
