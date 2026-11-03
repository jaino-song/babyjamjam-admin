import { test, expect, type Page, type Route } from '@playwright/test';
import type { DashboardStats } from "../src/hooks/useDashboardStats";
import type { ClientListSummary } from "../src/features/clients/types";
import type { EformsignDocumentJobSummary, ConsultationInquiryListResponse } from "../src/services/api";
import type { ClientActionRequiredAlert } from "../src/hooks/useClientAlerts";
import type { Notification as AppNotification } from "../src/hooks/usePushNotification";

const mock_auth_response = {
  id: 'test-user',
  name: '테스트 사용자',
  email: 'test@example.com',
  profile_image: '',
  role: 'admin',
};

const mock_chat_messages = [
  { role: 'user', content: '안녕하세요', timestamp: '2026-01-19t10:00:00.000z' },
  { role: 'assistant', content: '안녕하세요! 무엇을 도와드릴까요?', timestamp: '2026-01-19t10:00:01.000z' },
];

type FeedbackPayload = {
  type?: string;
  comment?: string;
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
    (window as typeof window & { __e2e_auth__?: boolean }).__e2e_auth__ = true;
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mock_auth_response),
    });
  });

  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mock_auth_response),
    });
  });
};

test.describe('chat message feedback', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthMocks(page);

    await page.route('**/api/ai/chat/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: mock_chat_messages,
          total: mock_chat_messages.length,
          hasMore: false,
          sessionId: 'test-session-id',
          isSessionActive: true,
        }),
      });
    });
  });

  test('should show feedback buttons on assistant messages', async ({ page }) => {
    // The dashboard chat widget was removed; the chat now lives on its own /chat page.
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-component="desktop_chat_page_header"]').getByRole('heading', { level: 1, name: '현재 대화', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('message-feedback')).toBeVisible({ timeout: 5000 });
  });

  test('should send positive feedback on thumbs up click', async ({ page }) => {
    let feedbackCalled = false;
    let feedbackData: FeedbackPayload | null = null;

    await page.route('**/api/ai/chat/feedback', async (route) => {
      feedbackCalled = true;
      feedbackData = route.request().postDataJSON() as FeedbackPayload;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // The dashboard chat widget was removed; the chat now lives on its own /chat page.
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('thumbs-up')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('thumbs-up').click();

    await expect(() => {
      expect(feedbackCalled).toBe(true);
      expect(feedbackData?.type).toBe('positive');
    }).toPass({ timeout: 5000 });
  });

  test('should open modal on thumbs down click', async ({ page }) => {
    // The dashboard chat widget was removed; the chat now lives on its own /chat page.
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('thumbs-down')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('thumbs-down').click();

    await expect(page.getByText('어떤 점이 불만족스러우셨나요?')).toBeVisible({ timeout: 5000 });
  });

  test('should have submit button disabled until comment is entered', async ({ page }) => {
    // The dashboard chat widget was removed; the chat now lives on its own /chat page.
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('thumbs-down').click();
    await expect(page.getByText('어떤 점이 불만족스러우셨나요?')).toBeVisible({ timeout: 5000 });

    const submitButton = page.getByRole('button', { name: '제출' });
    await expect(submitButton).toBeDisabled();

    await page.getByPlaceholder('피드백을 입력해주세요...').fill('응답이 부정확해요');
    await expect(submitButton).toBeEnabled();
  });

  test('should send negative feedback with comment', async ({ page }) => {
    let feedbackData: FeedbackPayload | null = null;

    await page.route('**/api/ai/chat/feedback', async (route) => {
      feedbackData = route.request().postDataJSON() as FeedbackPayload;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // The dashboard chat widget was removed; the chat now lives on its own /chat page.
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('thumbs-down').click();
    await page.getByPlaceholder('피드백을 입력해주세요...').fill('응답이 부정확해요');
    await page.getByRole('button', { name: '제출' }).click();

    await expect(() => {
      expect(feedbackData?.type).toBe('negative');
      expect(feedbackData?.comment).toBe('응답이 부정확해요');
    }).toPass({ timeout: 5000 });
  });
});
