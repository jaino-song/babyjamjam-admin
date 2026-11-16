import { expect, test, type Page } from "@playwright/test";

// /agent uses the server-owned agent protocol, independently of the former UI flag.
async function setupAgent(page: Page, persistSession = false) {
  await page.addInitScript((persist) => {
    sessionStorage.removeItem("agent_session_id");
    if (persist) sessionStorage.setItem("agent_session_id", "test-session-id");
  }, persistSession);
  await page.route("**/api/ai/agent/capabilities", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([{
      name: "clients.search", domain: "clients", version: "1.0.0", description: "Search clients",
      risk: "read", requiredRoles: ["owner"], renderer: "entity-choice",
      flagKey: "agent.capability.clients.search", sideEffect: false,
    }]),
  }));
  await page.route("**/api/ai/agent/sessions", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: "[]",
  }));
}

const INPUT = '[data-component="mobile_chat_agent-shell_composer_input"]';
const THREAD = '[data-component="mobile_chat_agent-shell_thread"]';
const BUBBLES = `${THREAD} article`;
const streamResponse = (text: string) => [
  'data: {"type":"start","messageId":"assistant-stream"}',
  `data: ${JSON.stringify({ type: "text-delta", delta: text })}`,
  'data: [DONE]', '',
].join("\n\n");

const MOCK_CHAT_MESSAGES = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "안녕하세요" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "안녕하세요! 무엇을 도와드릴까요?" }] },
  { id: "u2", role: "user", parts: [{ type: "text", text: "고객 목록 보여줘" }] },
  { id: "a2", role: "assistant", parts: [{ type: "text", text: "고객 목록을 조회합니다..." }] },
];
const session = (messages = MOCK_CHAT_MESSAGES) => ({ id: "test-session-id", title: "대화", updatedAt: new Date().toISOString(), messages });

test.describe('Chat History Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await setupAgent(page, true);

        await page.route('**/api/ai/agent/sessions/test-session-id', (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session()) }));

        await page.route('**/api/ai/agent/chat', (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "x-agent-session-id": "test-session-id" }, body: streamResponse("테스트 응답입니다.") }));
    });

    test('loads persisted history on /agent', async ({ page }) => {
        await page.goto('/agent');

        await expect(page.locator(THREAD)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('안녕하세요! 무엇을 도와드릴까요?').first()).toBeVisible();
        await expect(page.getByText('고객 목록 보여줘')).toBeVisible();
    });

    test('shows an empty conversation when no history exists', async ({ page }) => {
        await page.route('**/api/ai/agent/sessions/test-session-id', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(session([])),
            });
        });

        await page.goto('/agent');

        await expect(page.locator(THREAD)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(BUBBLES)).toHaveCount(0);
        await expect(page.locator(INPUT)).toBeEnabled();
    });

    test('sends a message and renders the streamed response', async ({ page }) => {
        await page.goto('/agent');

        const chatInput = page.locator(INPUT);
        await expect(chatInput).toBeVisible({ timeout: 15000 });

        await chatInput.fill('새로운 메시지');
        await chatInput.press('Enter');

        await expect(page.getByText('새로운 메시지')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('테스트 응답입니다.')).toBeVisible({ timeout: 10000 });
    });

    test('reload restores the persisted conversation', async ({ page }) => {
        await page.goto('/agent');
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 15000 });

        await page.reload();

        await expect(page.locator(THREAD)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('고객 목록 보여줘')).toBeVisible();
    });

    test('page stays interactive while history is still loading', async ({ page }) => {
        let resolveHistory: () => void;
        const historyPromise = new Promise<void>((resolve) => {
            resolveHistory = resolve;
        });

        await page.route('**/api/ai/agent/sessions/test-session-id', async (route) => {
            await historyPromise;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(session()),
            });
        });

        await page.goto('/agent');

        // History fetch is non-blocking: composer must render before it lands.
        await expect(page.locator(INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(BUBBLES)).toHaveCount(0);

        resolveHistory!();

        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
    });

    test('새 대화 clears the current session', async ({ page }) => {
        await page.goto('/agent');
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: '새 대화' }).click();

        await expect(page.locator(BUBBLES)).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator(INPUT)).toBeEnabled();
    });
});

test.describe('Chat History API Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        await setupAgent(page, true);
    });

    test('handles a history 500 without crashing the page', async ({ page }) => {
        await page.route('**/api/ai/agent/sessions/test-session-id', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        });

        await page.goto('/agent');

        await expect(page.locator(INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(THREAD)).toBeVisible();
    });

    test('handles a history 401 without crashing the page', async ({ page }) => {
        await page.route('**/api/ai/agent/sessions/test-session-id', async (route) => {
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Unauthorized' }),
            });
        });

        await page.goto('/agent');

        await expect(page.locator(INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(THREAD)).toBeVisible();
    });
});
