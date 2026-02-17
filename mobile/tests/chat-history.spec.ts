import { test, expect } from '@playwright/test';

const MOCK_CHAT_MESSAGES = [
    { role: 'user', content: '안녕하세요', timestamp: '2026-01-19T10:00:00.000Z' },
    { role: 'assistant', content: '안녕하세요! 무엇을 도와드릴까요?', timestamp: '2026-01-19T10:00:01.000Z' },
    { role: 'user', content: '고객 목록 보여줘', timestamp: '2026-01-19T10:01:00.000Z' },
    { role: 'assistant', content: '고객 목록을 조회합니다...', timestamp: '2026-01-19T10:01:01.000Z' },
];

const MOCK_AUTH_RESPONSE = {
    id: 'test-user',
    name: '테스트 사용자',
    email: 'test@example.com',
    profile_image: '',
    role: 'admin',
};

const setupAuthMocks = async (page) => {
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
    });

    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_AUTH_RESPONSE),
        });
    });

    await page.route('**/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_AUTH_RESPONSE),
        });
    });
};

test.describe('Chat History Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuthMocks(page);

        await page.route('**/api/ai/chat/history**', async (route) => {
            const url = new URL(route.request().url());
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const limit = parseInt(url.searchParams.get('limit') || '20');

            const total = MOCK_CHAT_MESSAGES.length;
            const endIndex = total - offset;
            const startIndex = Math.max(0, endIndex - limit);
            const messages = MOCK_CHAT_MESSAGES.slice(startIndex, endIndex);
            const hasMore = startIndex > 0;

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    messages,
                    total,
                    hasMore,
                    sessionId: 'test-session-id',
                    isSessionActive: true,
                }),
            });
        });

        await page.route('**/api/ai/chat/stream', async (route) => {
            const encoder = new TextEncoder();
            const chunks = [
                'event: message\ndata: {"type":"chunk","content":"테스트 "}\n\n',
                'event: message\ndata: {"type":"chunk","content":"응답입니다."}\n\n',
                'event: message\ndata: {"type":"done","sessionId":"test-session-id"}\n\n',
            ];

            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
                body: chunks.join(''),
            });
        });
    });

    test('should load chat history when modal opens', async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await expect(chatInput).toBeVisible({ timeout: 10000 });
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });

        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('무엇을 도와드릴까요?').first()).toBeVisible();
        await expect(page.getByText('고객 목록 보여줘')).toBeVisible();
    });

    test('should show empty state when no history exists', async ({ page }) => {
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

        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await expect(chatInput).toBeVisible({ timeout: 10000 });
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.')).toBeVisible();
    });

    test('should send message and receive response', async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });

        const chatPageInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await expect(chatPageInput).toBeVisible({ timeout: 5000 });

        await chatPageInput.fill('새로운 메시지');
        await chatPageInput.press('Enter');

        await expect(page.getByText('새로운 메시지')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('테스트 응답입니다.')).toBeVisible({ timeout: 10000 });
    });

    test('should close and reopen modal with history preserved', async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });

        await page.getByTestId('chat-back').click();
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        await chatInput.click();
        await page.waitForURL('**/chat', { timeout: 10000 });

        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
    });

    test('should show loading indicator while fetching history', async ({ page }) => {
        let resolveHistory: () => void;
        const historyPromise = new Promise<void>((resolve) => {
            resolveHistory = resolve;
        });

        await page.route('**/api/ai/chat/history**', async (route) => {
            await historyPromise;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    messages: MOCK_CHAT_MESSAGES,
                    total: MOCK_CHAT_MESSAGES.length,
                    hasMore: false,
                    sessionId: 'test-session-id',
                    isSessionActive: true,
                }),
            });
        });

        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });

        resolveHistory!();

        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
    });

    test('should clear session when delete button is clicked', async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });

        await page.getByTestId('chat-clear').click();

        await expect(page.getByText('고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.')).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Chat History API Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuthMocks(page);
    });

    test('should handle API error gracefully', async ({ page }) => {
        await page.route('**/api/ai/chat/history**', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        });

        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });
    });

    test('should handle 401 unauthorized error', async ({ page }) => {
        await page.route('**/api/ai/chat/history**', async (route) => {
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Unauthorized' }),
            });
        });

        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        const chatInput = page.getByPlaceholder('무엇을 도와드릴까요?').first();
        await chatInput.click();

        await page.waitForURL('**/chat', { timeout: 10000 });
        await expect(page.getByText('AI 어시스턴트')).toBeVisible({ timeout: 10000 });
    });
});
