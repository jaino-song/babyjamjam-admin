import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { shouldRetryQuery } from "@/lib/queryClient";
import AgentDiagnosticsPage from "./page";

const diagnostics = {
  agentVersion: "1.2.3",
  model: "test-model",
  capabilityCount: 7,
  capabilityVersions: { read: "1" },
  enabled: false,
  rolloutStage: "internal",
  allowlists: { branches: 2, users: 3 },
  effectiveFlags: { domains: { clients: true }, capabilities: { read: true }, branchAllowlist: ["b1"], userAllowlist: ["u1"] },
  readEnabled: false,
  writeEnabled: false,
  externalEnabled: false,
  privilegedEnabled: false,
  manifestFresh: true,
  drift: { status: "clean", inventory: 4 },
  evals: { suite: "s", requiredCases: 9, evidence: { status: "passed", caseCount: 9 } },
  actions: { pending: 5, uncertain: 1, succeeded: 8, failed: 0 },
};

const action = {
  id: "a1", capability: "client.update", status: "pending", risk: "low", branchId: "b1",
  capabilityVersion: "1", createdAt: "2026-10-01T03:00:00.000Z", updatedAt: "2026-10-01T03:00:00.000Z",
  expiresAt: "2026-10-02T03:00:00.000Z", errorCode: null,
};

type Reply = { ok: boolean; status?: number; body?: unknown } | "network-error";
const replies: { diagnostics: Reply; actions: Reply } = {
  diagnostics: { ok: true, body: diagnostics },
  actions: { ok: true, body: [] },
};
const fetchMock = jest.fn();

function respond(reply: Reply) {
  if (reply === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
  return Promise.resolve({ ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 500), json: () => Promise.resolve(reply.body) });
}

function callsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => url === path).length;
}

function renderPage(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return render(
    <QueryClientProvider client={client}>
      <AgentDiagnosticsPage />
    </QueryClientProvider>,
  );
}

function renderPageWithRealRetryPolicy() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentDiagnosticsPage />
    </QueryClientProvider>,
  );
}

function statValues(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'), (node) => node.textContent);
}

function runtimeCard(container: HTMLElement) {
  return container.querySelector('[data-component="desktop_admin_agent-diagnostics_overview"]') as HTMLElement;
}

function actionsCard(container: HTMLElement) {
  return container.querySelector('[data-component="desktop_admin_agent-diagnostics_actions"]') as HTMLElement;
}

beforeEach(() => {
  jest.resetAllMocks();
  replies.diagnostics = { ok: true, body: diagnostics };
  replies.actions = { ok: true, body: [] };
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/ai/agent/diagnostics") return respond(replies.diagnostics);
    if (url === "/api/ai/agent/diagnostics/actions") return respond(replies.actions);
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("AgentDiagnosticsPage diagnostics", () => {
  it("shows a retryable failure that keeps the hint, and no runtime values", async () => {
    replies.diagnostics = { ok: false };
    const { container } = renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("에이전트 진단 정보를 불러오지 못했습니다");
    expect(alert).toHaveTextContent("owner 권한과 에이전트 백엔드 연결을 확인해 주세요.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("진단을 불러올 수 없어요")).not.toBeInTheDocument();
    expect(screen.queryByText("disabled")).not.toBeInTheDocument();
    expect(runtimeCard(container)).toBeNull();

    replies.diagnostics = { ok: true, body: diagnostics };
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(callsTo("/api/ai/agent/diagnostics")).toBe(2);
  });

  it("treats a paused first load like loading: every runtime value is a placeholder", async () => {
    onlineManager.setOnline(false);
    try {
      const { container } = renderPage();

      const card = runtimeCard(container);
      expect(card).toBeInTheDocument();
      const text = card.textContent ?? "";
      expect(within(card).queryByText(/^(enabled|disabled|fresh|failed)$/)).not.toBeInTheDocument();
      expect(text).not.toContain("missing");
      expect(text).not.toContain("{}");
      expect(text).not.toMatch(/0/);
      expect(within(card).getAllByText("-").length).toBeGreaterThanOrEqual(16);
      expect(statValues(container)).not.toContain("0");
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("shows placeholders while the first load is still in flight", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();

    const text = runtimeCard(container).textContent ?? "";
    expect(within(runtimeCard(container)).queryByText(/^(enabled|disabled|fresh|failed)$/)).not.toBeInTheDocument();
    expect(text).not.toMatch(/0/);
    expect(statValues(container)).not.toContain("0");
  });

  it("shows the real values, including a disabled flag, after a successful load", async () => {
    const { container } = renderPage();

    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    const card = runtimeCard(container);
    expect(within(card).getAllByText("disabled").length).toBe(5);
    expect(within(card).getByText("fresh")).toBeInTheDocument();
    expect(within(card).getByText("지점 2 · 사용자 3")).toBeInTheDocument();
    expect(within(card).getByText("clean (4)")).toBeInTheDocument();
    expect(within(card).getByText("passed · 9/9 cases")).toBeInTheDocument();
    expect(statValues(container)).toEqual(["7", "5", "1", "8"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached diagnostics and shows one notice whose retry refetches when a refresh fails", async () => {
    replies.diagnostics = { ok: false };
    const { container } = renderPage((client) => client.setQueryData(["agentDiagnostics"], diagnostics));

    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(statValues(container)).toEqual(["7", "5", "1", "8"]);
    expect(within(runtimeCard(container)).getByText("fresh")).toBeInTheDocument();

    replies.diagnostics = { ok: true, body: diagnostics };
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(callsTo("/api/ai/agent/diagnostics")).toBe(2);
  });

  it("keeps cached diagnostics and adds no notice while the refresh is paused", async () => {
    onlineManager.setOnline(false);
    try {
      const { container } = renderPage((client) => client.setQueryData(["agentDiagnostics"], diagnostics));

      expect(await screen.findByText("1.2.3")).toBeInTheDocument();
      expect(statValues(container)).toEqual(["7", "5", "1", "8"]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe("AgentDiagnosticsPage actions", () => {
  it.each([
    ["an error response", { ok: false } as Reply],
    ["a network failure", "network-error" as Reply],
  ])("shows a retryable failure, not 'no work', after %s", async (_label, reply) => {
    replies.actions = reply;
    const { container } = renderPage();

    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    const alert = await within(actionsCard(container)).findByRole("alert");
    expect(alert).toHaveTextContent("작업 목록을 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("대기 중이거나 확인이 필요한 작업이 없습니다.")).not.toBeInTheDocument();

    replies.actions = { ok: true, body: [action] };
    fireEvent.click(within(actionsCard(container)).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText(/client\.update@1/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(callsTo("/api/ai/agent/diagnostics/actions")).toBe(2);
  });

  it("shows the empty text only after a successful empty load", async () => {
    const { container } = renderPage();

    expect(await screen.findByText("대기 중이거나 확인이 필요한 작업이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(actionsCard(container)).toBeInTheDocument();
  });

  it("does not show the empty text while the actions load is in flight or paused", async () => {
    onlineManager.setOnline(false);
    try {
      const { container } = renderPage();

      expect(screen.queryByText("대기 중이거나 확인이 필요한 작업이 없습니다.")).not.toBeInTheDocument();
      expect(within(actionsCard(container)).getByText("-")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("keeps cached actions and shows one notice whose retry refetches when a refresh fails", async () => {
    replies.actions = { ok: false };
    const { container } = renderPage((client) => client.setQueryData(["agentActions"], [action]));

    expect(await screen.findByText(/client\.update@1/)).toBeInTheDocument();
    const alert = await within(actionsCard(container)).findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("대기 중이거나 확인이 필요한 작업이 없습니다.")).not.toBeInTheDocument();

    replies.actions = { ok: true, body: [action] };
    fireEvent.click(within(actionsCard(container)).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(callsTo("/api/ai/agent/diagnostics/actions")).toBe(2);
  });
});

describe("AgentDiagnosticsPage retry policy", () => {
  const endpoints = [
    { name: "actions", path: "/api/ai/agent/diagnostics/actions", key: "actions" as const, title: "작업 목록을 불러오지 못했습니다" },
    { name: "diagnostics", path: "/api/ai/agent/diagnostics", key: "diagnostics" as const, title: "에이전트 진단 정보를 불러오지 못했습니다" },
  ];
  const cases: [string, Reply, number][] = [
    ["a 403", { ok: false, status: 403 }, 1],
    ["a 429", { ok: false, status: 429 }, 1],
    ["a 500", { ok: false, status: 500 }, 4],
    ["a network failure", "network-error", 4],
  ];

  describe.each(endpoints)("$name endpoint", ({ path, key, title }) => {
    it.each(cases)("sends the expected number of requests for %s", async (_label, reply, expected) => {
      replies[key] = reply;
      renderPageWithRealRetryPolicy();

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(callsTo(path)).toBe(expected);
    });
  });
});
