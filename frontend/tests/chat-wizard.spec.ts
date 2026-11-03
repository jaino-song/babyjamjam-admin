import { test, expect, type Page, type Route } from '@playwright/test';
import type { DashboardStats } from "../src/hooks/useDashboardStats";
import type { ClientListSummary } from "../src/features/clients/types";
import type { EformsignDocumentJobSummary, ConsultationInquiryListResponse } from "../src/services/api";
import type { ClientActionRequiredAlert } from "../src/hooks/useClientAlerts";
import type { Notification as AppNotification } from "../src/hooks/usePushNotification";

const MOCK_AUTH_RESPONSE = {
  id: 'test-user',
  name: '테스트 사용자',
  email: 'test@example.com',
  profile_image: '',
  role: 'admin',
};

const setupAuthMocks = async (page: Page) => {
  // These UI-only reads must stay isolated from the real backend under mock auth.
  // Match exact paths and GET only; auth refresh and every mutation remain unmocked.
  const workspaceReadFixtures = [
      { pathname: "/api/clients/stats", json: { activeClients: 0, contractsNotSent: 0, contractsPendingSignature: 0, upcomingThisMonth: 0, upcomingNextMonth: 0 } satisfies DashboardStats },
      { pathname: "/api/clients/list-summary", json: {
          total: 0,
          byTab: { all: 0, pre_booking: 0, waiting: 0, replacement_requested: 0, active: 0, completed: 0, terminated: 0 },
          dueDate: { thisMonth: 0, nextMonth: 0 },
          serviceEnd: { count: 0, from: "2026-11-01", to: "2026-11-07" },
      } satisfies ClientListSummary },
      { pathname: "/api/eformsign-docs/jobs/summary", json: { activeCount: 0, requiresAttentionCount: 0, failedCount: 0, unresolvedCount: 0, unresolvedJobIds: [] } satisfies EformsignDocumentJobSummary },
      { pathname: "/api/consultation-inquiries", json: { data: [], total: 0, page: 1, limit: 1, totalPages: 0 } satisfies ConsultationInquiryListResponse },
      { pathname: "/api/clients/alerts", json: [] satisfies ClientActionRequiredAlert[] },
      { pathname: "/api/notifications", json: [] satisfies AppNotification[] },
      { pathname: "/api/notifications/unread/count", json: { count: 0 } satisfies { count: number } },
  ];
  for (const fixture of workspaceReadFixtures) {
      await page.route((url) => url.pathname === fixture.pathname, async (route) => {
          if (route.request().method() !== "GET") {
              await route.fallback();
              return;
          }
          await route.fulfill({ status: 200, json: fixture.json });
      });
  }

  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });

  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });
};

test.describe('Chat client registration wizard', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthMocks(page);

    await page.route('**/api/ai/chat/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [],
          total: 0,
          hasMore: false,
          sessionId: null,
          isSessionActive: false,
        }),
      });
    });

    await page.route('**/api/voucher-price-infos/years', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([2026]),
      });
    });

    await page.route('**/api/voucher-price-infos/type**', async (route) => {
      const url = new URL(route.request().url());
      const type = url.searchParams.get('type');
      const year = url.searchParams.get('year');

      if (type === 'A가1형' && year === '2026') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 1,
              type: 'A가1형',
              duration: '10',
              fullPrice: '100000',
              grant: '50000',
              actualPrice: '50000',
            },
          ]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('opens wizard via chip and submits to /api/clients without SSE', async ({ page }) => {
    let sseCalled = 0;
    await page.route('**/api/ai/chat/stream', async (route) => {
      sseCalled += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'SSE should not be called for local wizard' }),
      });
    });

    let createCalled = 0;
    await page.route('**/api/clients', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      createCalled += 1;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        name: '홍길동',
        phone: '010-1234-5678',
        birthday: '1990-01-01',
        address: '인천 연수구',
        dueDate: '2026-02-01',
        voucherClient: true,
        type: 'A가1형',
        duration: 10,
        fullPrice: '100000',
        grant: '50000',
        actualPrice: '50000',
      });

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 123, name: '홍길동' }),
      });
    });

    // The dashboard chat widget was removed; the chat is its own /chat page.
    await page.goto('/chat');
    await expect(page.locator('[data-component="desktop_chat_page_header"]').getByRole('heading', { level: 1, name: '새 대화', exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: '산모 등록' }).click();
    await expect(page.getByLabel('이름')).toBeVisible({ timeout: 5000 });

    await page.getByLabel('이름').fill('홍길동');
    await page.getByLabel('연락처').fill('01012345678');
    await page.getByLabel('생년월일').fill('19900101');
    await expect(page.getByLabel('생년월일')).toHaveValue('1990-01-01');
    await page.getByLabel('주소').fill('인천 연수구');
    await page.getByLabel('출산 예정일').fill('2026-02-01');
    await page.getByRole('button', { name: '다음' }).click();

    // Voucher info step: pick type + duration
    await page.getByLabel('바우처 유형').click();
    await page.locator('[role="option"]').filter({ hasText: 'A가-1형' }).first().click();

    await page.getByLabel('기간').click();
    await page.locator('[role="option"]').filter({ hasText: '10일' }).first().click();

    await page.getByRole('button', { name: '다음' }).click();

    await page.getByRole('checkbox', { name: '조리원 여부' }).check();
    await page.getByRole('button', { name: '제출' }).click();

    await expect(page.getByText('산모 등록 완료: 홍길동 (ID: 123)')).toBeVisible({ timeout: 5000 });
    expect(createCalled).toBe(1);
    expect(sseCalled).toBe(0);
  });
});
