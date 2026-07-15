import { test, expect, type Page, type Route } from '@playwright/test';

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
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
    await chatInput.click();

    await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 5000 });
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

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
    await chatInput.click();

    await expect(page.getByTestId('thumbs-up')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('thumbs-up').click();

    await expect(() => {
      expect(feedbackCalled).toBe(true);
      expect(feedbackData?.type).toBe('positive');
    }).toPass({ timeout: 5000 });
  });

  test('should open modal on thumbs down click', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
    await chatInput.click();

    await expect(page.getByTestId('thumbs-down')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('thumbs-down').click();

    await expect(page.getByText('어떤 점이 불만족스러우셨나요?')).toBeVisible({ timeout: 5000 });
  });

  test('should have submit button disabled until comment is entered', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
    await chatInput.click();

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

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
    await chatInput.click();

    await page.getByTestId('thumbs-down').click();
    await page.getByPlaceholder('피드백을 입력해주세요...').fill('응답이 부정확해요');
    await page.getByRole('button', { name: '제출' }).click();

    await expect(() => {
      expect(feedbackData?.type).toBe('negative');
      expect(feedbackData?.comment).toBe('응답이 부정확해요');
    }).toPass({ timeout: 5000 });
  });
});
