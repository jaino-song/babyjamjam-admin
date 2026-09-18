import { expect, test, type Page, type Route } from "@playwright/test";
import { AgentCapabilityMetaSchema, AgentTaskSchema, type AgentTask } from "@babyjamjam/shared/agent";

const enabled = process.env.RUN_AGENT_REAL_E2E === "1";
const mockedEnabled = process.env.RUN_AGENT_E2E === "1" && !enabled;

const TASK_IDS = {
  task: "11111111-1111-4111-8111-111111111111",
  session: "22222222-2222-4222-8222-222222222222",
  taskSnapshot: "33333333-3333-4333-8333-333333333333",
  streamSnapshot: "44444444-4444-4444-8444-444444444444",
};

function makeTask(revision = 1, name = "홍길동"): AgentTask {
  return AgentTaskSchema.parse({
    schemaVersion: 1,
    taskId: TASK_IDS.task,
    sessionId: TASK_IDS.session,
    kind: "clients.create",
    capabilityId: "clients.create",
    revision,
    state: "collecting",
    confirmed: { name, phone: "01012345678" },
    tentative: {},
    clearedFields: [],
    provenance: { confirmed: { name: { source: "user" }, phone: { source: "user" } }, tentative: {} },
    issues: [],
    constraints: { noSend: false },
    choiceSets: [],
    orderedChoiceRefs: [],
    target: null,
    consent: { choice: "unanswered", binding: null },
    action: null,
    times: { createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:01.000Z" },
    currentSnapshotRef: TASK_IDS.taskSnapshot,
  });
}

async function setupMockRoutes(page: Page) {
  let streamCount = 0;
  let patchCount = 0;
  const initialTask = makeTask();
  const latestTask = makeTask(2, "김철수");
  await page.route("**/api/ai/agent/capabilities", async (route: Route) => {
    const capability = {
      name: "clients.create",
      domain: "clients",
      version: "1.0.0",
      description: "Create a client draft",
      risk: "irreversible-write",
      requiredRoles: ["owner", "admin"],
      renderer: "task-snapshot",
      flagKey: "agent.capability.clients.create",
      sideEffect: true,
      approvalPolicy: "structured",
      idempotencyPolicy: "action-id",
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([AgentCapabilityMetaSchema.parse(capability)]) });
  });
  await page.route("**/api/ai/agent/sessions", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`**/api/ai/agent/tasks/${TASK_IDS.task}`, async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(patchCount > 0 ? latestTask : initialTask) });
      return;
    }
    if (route.request().method() === "PATCH") {
      patchCount += 1;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ snapshot: latestTask }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "method_not_allowed" }) });
  });
  await page.route("**/api/ai/agent/chat", async (route: Route) => {
    streamCount += 1;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-agent-session-id": "session-a" },
      body: [
        `data: {"type":"start","messageId":"mobile-agent-message"}`,
        `data: {"type":"data-task-snapshot","data":{"taskId":"${TASK_IDS.task}","snapshotRef":"${TASK_IDS.streamSnapshot}","kind":"clients.create","capabilityId":"clients.create","revision":1,"state":"collecting","fieldStatus":[{"field":"name","status":"confirmed"},{"field":"phone","status":"confirmed"}]}}`,
        'data: {"type":"text-delta","delta":"모바일 브라우저 계약 응답입니다."}',
        "",
      ].join("\n\n"),
    });
  });
  return { streamCount: () => streamCount, patchCount: () => patchCount };
}

test.describe("Mobile operational copilot real backend", () => {
  test("streams through the mobile proxy and restores the server-owned session", async ({ page }) => {
    test.skip(!enabled, "Run with RUN_AGENT_REAL_E2E=1 after building with the agent shell enabled");
    await page.goto("/chat");
    await expect(page.locator('[data-component="mobile_chat_agent-shell"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_shell_header"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_shell_bottom-nav"]')).toHaveCount(0);

    const input = page.getByLabel("질문 입력");
    await input.fill("홍길동 산모 찾아줘");
    await input.press("Enter");
    await expect(page.getByText("[agent-e2e-stub] 조회 결과를 확인했습니다.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "전송" })).toBeVisible();

    await page.getByRole("button", { name: "대화 목록" }).click();
    await expect(page.getByText("브랜치별 대화는 안전하게 분리됩니다.")).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();

    await page.reload();
    await expect(page.locator('[data-component="mobile_chat_agent-shell"]')).toBeVisible();
    await page.getByRole("button", { name: "대화 목록" }).click();
    await expect(page.locator('[data-component="mobile_chat_agent-shell_drawer"] button').first()).toBeVisible();
  });
});

test.describe("Mobile operational copilot browser contract", () => {
  test("guards IME Enter, drawer focus/inert, and refreshes a conflicted task", async ({ page }) => {
    test.skip(!mockedEnabled, "Run with RUN_AGENT_E2E=1 for the authenticated mocked browser contract");
    const routes = await setupMockRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat");
    await expect(page.locator('[data-component="mobile_chat_agent-shell"]')).toBeVisible();

    const input = page.getByLabel("질문 입력");
    await input.fill("조합중 입력");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
    await expect.poll(routes.streamCount).toBe(0);
    await expect(input).toHaveValue("조합중 입력");
    await input.press("Enter");
    await expect.poll(routes.streamCount).toBe(1);
    await expect(page.getByText("모바일 브라우저 계약 응답입니다.")).toBeVisible();

    const menu = page.getByRole("button", { name: "대화 목록" });
    await menu.focus();
    await menu.click();
    const drawer = page.locator('[data-component="mobile_chat_agent-shell_drawer"]');
    const content = page.locator('[data-slot="application-content"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-component"))).toBe("mobile_chat_agent-shell_drawer");
    await expect(content).toHaveJSProperty("inert", true);
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(content).toHaveJSProperty("inert", false);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("대화 목록");

    const controls = page.locator('[data-component="mobile_chat_agent-shell_thread_task-controls"]');
    await expect(controls).toBeVisible();
    const thread = page.locator('[data-component="mobile_chat_agent-shell_thread"]');
    const scrollBefore = await thread.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { top: element.scrollTop, height: element.scrollHeight, clientHeight: element.clientHeight };
    });
    expect(scrollBefore.height).toBeGreaterThan(scrollBefore.clientHeight);
    const draftValue = page.locator('[data-component="mobile_chat_agent-shell_thread_task-controls_edit-field_name_control"]');
    await draftValue.fill("이순신");
    await page.getByRole("button", { name: "변경 적용" }).click();
    await expect.poll(routes.patchCount).toBe(1);
    await expect(page.locator('[data-component="mobile_chat_agent-shell_thread_task-conflict"]')).toBeVisible();
    await page.getByRole("button", { name: "최신 초안 불러오기" }).click();
    await expect(page.locator('[data-component="mobile_chat_agent-shell_thread_task-conflict"]')).toBeHidden();
    await expect(page.getByText("버전 2")).toBeVisible();
    await expect.poll(() => thread.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(scrollBefore.top - 1);
  });
});
