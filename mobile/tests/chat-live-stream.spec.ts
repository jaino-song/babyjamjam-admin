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

test.beforeEach(async ({ page }) => { await setupAgent(page); });

test("streams a deterministic agent response on /agent", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/ai/agent/chat", async (route) => {
    await pending;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "x-agent-session-id": "test-session-id" }, body: streamResponse("[e2e-stub] 안녕하세요") });
  });
  await page.goto("/agent");
  await expect(page.locator(THREAD)).toBeVisible();
  const input = page.locator(INPUT);
  await expect(input).toBeEnabled();
  await input.fill("안녕하세요");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeVisible();
  release();
  const assistant = page.locator(`${THREAD} article`).last();
  await expect(assistant).toContainText("[e2e-stub]");
  await expect(assistant).toContainText("안녕하세요");
  await expect(page.getByRole("button", { name: "중지", exact: true })).toHaveCount(0);
  await expect(input).toBeEnabled();
});

test("routes registration requests through the agent instead of legacy local interception", async ({ page }) => {
  let agentCalls = 0;
  let legacyCalls = 0;
  await page.route("**/api/ai/chat/stream", async (route) => { legacyCalls += 1; await route.abort(); });
  await page.route("**/api/ai/agent/chat", async (route) => {
    agentCalls += 1;
    expect(route.request().postDataJSON().messages[0].parts).toEqual([{ type: "text", text: "산모 등록" }]);
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: streamResponse("등록에 필요한 정보를 알려주세요.") });
  });
  await page.goto("/agent");
  await expect(page.locator(INPUT)).toBeEnabled();
  await page.locator(INPUT).fill("산모 등록");
  await page.locator(INPUT).press("Enter");
  await expect(page.getByText("등록에 필요한 정보를 알려주세요.")).toBeVisible();
  await expect(page.locator(`${BUBBLES}`).first()).toContainText("산모 등록");
  expect(agentCalls).toBe(1);
  expect(legacyCalls).toBe(0);
});
