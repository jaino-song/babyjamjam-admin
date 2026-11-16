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
const streamResponse = (text: string) => [
  'data: {"type":"start","messageId":"assistant-stream"}',
  `data: ${JSON.stringify({ type: "text-delta", delta: text })}`,
  'data: [DONE]', '',
].join("\n\n");

// Agent requests can have effects: unlike legacy chat they must not replay automatically.
test.beforeEach(async ({ page }) => { await setupAgent(page); });

test("allows an explicit new message after a failed request", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/agent/chat", async (route) => {
    calls += 1;
    if (calls === 1) { await route.abort("failed"); return; }
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: streamResponse("성공적인 응답입니다.") });
  });
  await page.goto("/agent");
  await expect(page.locator(INPUT)).toBeEnabled();
  await page.locator(INPUT).fill("테스트 메시지");
  await page.locator(INPUT).press("Enter");
  await expect(page.locator('[data-slot="agent-mobile-shell"]').getByRole("alert")).toContainText("응답 스트림이 중단되었습니다.");
  expect(calls).toBe(1);
  await page.locator(INPUT).fill("다시 질문합니다");
  await page.locator(INPUT).press("Enter");
  await expect(page.getByText("성공적인 응답입니다.")).toBeVisible();
  expect(calls).toBe(2);
});

test("shows an error without automatically replaying a failed agent request", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/agent/chat", async (route) => { calls += 1; await route.abort("failed"); });
  await page.goto("/agent");
  await expect(page.locator(INPUT)).toBeEnabled();
  await page.locator(INPUT).fill("테스트 메시지");
  await page.locator(INPUT).press("Enter");
  await expect(page.locator('[data-slot="agent-mobile-shell"]').getByRole("alert")).toContainText("응답 스트림이 중단되었습니다.");
  await expect(page.locator('[data-slot="agent-mobile-shell"]').getByRole("alert")).toContainText("작업은 실행되지 않았습니다.");
  expect(calls).toBe(1);
});
