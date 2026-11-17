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

// Registration is now an agent-owned structured form, not a local useChatStream wizard.
test("submits registration fields through the agent form contract", async ({ page }) => {
  await setupAgent(page);
  let chatCalls = 0;
  let directCreateCalls = 0;
  let submitted = false;
  const fields = [
    { name: "name", label: "이름", type: "text", required: true },
    { name: "phone", label: "연락처", type: "text", required: true },
    { name: "birthday", label: "생년월일", type: "text" },
    { name: "address", label: "주소", type: "text" },
    { name: "dueDate", label: "출산 예정일", type: "date" },
    { name: "type", label: "바우처 유형", type: "text" },
    { name: "duration", label: "기간", type: "number" },
    { name: "fullPrice", label: "총액", type: "text" },
    { name: "grant", label: "지원금", type: "text" },
    { name: "actualPrice", label: "본인부담금", type: "text" },
    { name: "voucherClient", label: "바우처 고객", type: "boolean" },
    { name: "careCenter", label: "조리원 여부", type: "boolean" },
  ];
  await page.route("**/api/clients", async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    directCreateCalls += 1;
    await route.abort();
  });
  await page.route("**/api/ai/agent/sessions/test-session-id", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      id: "test-session-id", title: "등록", updatedAt: new Date().toISOString(),
      messages: submitted ? [{ id: "done", role: "assistant", parts: [{ type: "text", text: "산모 등록 완료: 홍길동 (ID: 123)" }] }] : [],
    }),
  }));
  await page.route("**/api/ai/agent/chat", async (route) => {
    chatCalls += 1;
    const part = route.request().postDataJSON().messages[0].parts[0];
    if (part.type === "data-form-submit") {
      expect(part.data).toEqual({ formId: "registration", values: {
        name: "홍길동", phone: "010-1234-5678", birthday: "1990-01-01", address: "인천 연수구",
        dueDate: "2026-02-01", voucherClient: true, careCenter: true, type: "A가1형", duration: 10,
        fullPrice: "100000", grant: "50000", actualPrice: "50000",
      } });
      submitted = true;
      await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "x-agent-session-id": "test-session-id" }, body: "data: [DONE]\n\n" });
      return;
    }
    expect(part).toEqual({ type: "text", text: "산모 등록" });
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "x-agent-session-id": "test-session-id" }, body: `data: ${JSON.stringify({ type: "data-form", data: { formId: "registration", title: "산모 등록 정보", schemaVersion: "1", fields } })}\n\n` });
  });
  await page.goto("/agent");
  await expect(page.locator(INPUT)).toBeEnabled();
  await page.locator(INPUT).fill("산모 등록");
  await page.locator(INPUT).press("Enter");
  await expect(page.getByLabel("이름", { exact: true })).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill("홍길동");
  await page.getByLabel("연락처", { exact: true }).fill("010-1234-5678");
  await page.getByLabel("생년월일", { exact: true }).fill("1990-01-01");
  await page.getByLabel("주소", { exact: true }).fill("인천 연수구");
  await page.getByLabel("출산 예정일", { exact: true }).fill("2026-02-01");
  await page.getByLabel("바우처 유형", { exact: true }).fill("A가1형");
  await page.getByLabel("기간", { exact: true }).fill("10");
  await page.getByLabel("총액", { exact: true }).fill("100000");
  await page.getByLabel("지원금", { exact: true }).fill("50000");
  await page.getByLabel("본인부담금", { exact: true }).fill("50000");
  await page.getByRole("checkbox", { name: "바우처 고객" }).check();
  await page.getByRole("checkbox", { name: "조리원 여부" }).check();
  await page.getByRole("button", { name: "제출", exact: true }).click();
  await expect(page.getByText("산모 등록 완료: 홍길동 (ID: 123)")).toBeVisible();
  expect(chatCalls).toBe(2);
  expect(directCreateCalls).toBe(0);
});
