import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { MessageTriggerList } from "../MessageTriggerList";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRuleBranchActivation,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageTriggerRule } from "@/features/message-triggers/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
  useUpdateMessageTriggerRuleBranchActivation: jest.fn(),
  useUpdateMessageTriggerRule: jest.fn(),
}));

jest.mock("@/lib/messages/logs", () => ({
  fetchAllMessageLogs: jest.fn(),
}));

const mockUseMessageTriggerRules = useMessageTriggerRules as jest.Mock;
const mockUseUpdateMessageTriggerRule = useUpdateMessageTriggerRule as jest.Mock;
const mockUseUpdateMessageTriggerRuleBranchActivation = useUpdateMessageTriggerRuleBranchActivation as jest.Mock;
const mockFetchAllMessageLogs = fetchAllMessageLogs as jest.Mock;

function createRule(overrides: Partial<MessageTriggerRule> = {}): MessageTriggerRule {
  return {
    id: "rule-start",
    branchId: "branch-1",
    name: "실제 서비스 시작 규칙",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "SERVICE_START_REMINDER",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function currentMonthIso(day = 5) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0).toISOString();
}

function previousMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 5, 9, 0, 0).toISOString();
}

function monthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

function renderPage(onEdit?: (rule: MessageTriggerRule) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MessageTriggerList data-component="mobile_messages_triggers_test_list" canManage onEdit={onEdit} />
    </QueryClientProvider>,
  );
}

describe("MessageTriggerList", () => {
  const updateMutate = jest.fn();
  const branchActivationMutate = jest.fn();

  beforeEach(() => {
    updateMutate.mockClear();
    mockFetchAllMessageLogs.mockResolvedValue([]);
    mockUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutate: updateMutate,
    });
    mockUseUpdateMessageTriggerRuleBranchActivation.mockReturnValue({
      isPending: false,
      mutate: branchActivationMutate,
    });
    mockUseMessageTriggerRules.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders only actual trigger rules instead of fallback rows", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ sendTime: "14:37" })],
      isError: false,
      isLoading: false,
    });
    mockFetchAllMessageLogs.mockResolvedValue([
      {
        id: 1,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: currentMonthIso(5),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 2,
        templateKey: "SERVICE_START_REMINDER",
        status: "failed",
        createdAt: currentMonthIso(6),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 3,
        templateKey: "CLIENT_WELCOME",
        status: "sent",
        createdAt: currentMonthIso(6),
        ruleId: "rule-client",
        ruleName: "다른 규칙",
        eventType: "CLIENT_CREATED",
      },
      {
        id: 4,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: previousMonthIso(),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
    ]);

    renderPage();

    expect(screen.queryByText("신규 고객 인사 SMS")).not.toBeInTheDocument();
    expect(screen.getByText("실제 서비스 시작 규칙")).toBeInTheDocument();
    expect(screen.queryByText("고객 등록 환영")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${monthLabel()} 2건 · 서비스 시작 1일 전`))).toBeInTheDocument();
    });
    expect(
      document.querySelector(
        '[data-component="mobile_messages_triggers_test_list_item-rule-start_copy_subtitle"]',
      ),
    ).toHaveTextContent(`${monthLabel()} 2건 · 서비스 시작 1일 전 14:37 (한국 시간) · 고객 · SMS`);
  });

  it("displays the computed service-record timing instead of its carrier rule timing", () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({
        id: "system:service_record_link", branchId: null,
        name: "제공기록지 작성 링크", offsetType: "SAME_DAY", offsetDays: 0,
        sendTime: "15:00", recipientType: "PRIMARY_EMPLOYEE", templateKey: "SERVICE_RECORD_LINK",
      }), createRule({ id: "other-start", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "15:00" })],
      isError: false, isLoading: false,
    });
    renderPage();
    expect(screen.getByText(/서비스 시작 1일 전 12:00 \(한국 시간\) · 늦게 등록되면 즉시 발송 · 주 담당 직원 · SMS/)).toBeInTheDocument();
    expect(screen.getByText(/서비스 시작 당일 15:00 \(한국 시간\) · 고객 · SMS/)).toBeInTheDocument();
  });

  it("updates the selected real rule when the toggle row is pressed", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ isActive: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "rule-start",
      dto: { isActive: false },
    });
  });

  it("uses branch activation for global rules without sending the content DTO", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ id: "global-rule", branchId: null, isActive: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ }));

    expect(branchActivationMutate).toHaveBeenCalledWith({
      id: "global-rule",
      dto: { isActive: false },
    });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("disables a global-locked rule toggle", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ branchId: null, isLockedByGlobal: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ })).toBeDisabled();
  });

  it("separates rule editing from the active toggle in management mode", async () => {
    const onEdit = jest.fn();
    const rule = createRule({ isActive: true });
    mockUseMessageTriggerRules.mockReturnValue({ data: [rule], isError: false, isLoading: false });

    renderPage(onEdit);

    fireEvent.click(await screen.findByRole("button", { name: "실제 서비스 시작 규칙 설정" }));
    expect(onEdit).toHaveBeenCalledWith(rule);
    expect(updateMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch", { name: "실제 서비스 시작 규칙 비활성화" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "rule-start", dto: { isActive: false } });
  });

  it("renders the service information trigger seven days before service start", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [
        createRule({
          id: "rule-service-info",
          name: "서비스 시작 7일 전 서비스 안내",
          offsetDays: 7,
          templateKey: "SERVICE_INFO",
        }),
      ],
      isError: false,
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("서비스 시작 7일 전 서비스 안내")).toBeInTheDocument();
    expect(screen.getByText(/서비스 시작 7일 전 09:00 \(한국 시간\) · 고객 · SMS/)).toBeInTheDocument();
    const serviceInfoRow = screen.getByRole("button", { name: /서비스 시작 7일 전 서비스 안내/ });
    const serviceInfoItem = serviceInfoRow.closest('[data-trigger-channel="SMS"]');
    expect(serviceInfoItem).toHaveAttribute("data-trigger-channel", "SMS");
    expect(serviceInfoItem?.querySelector("svg")).toHaveClass("lucide-message-square-text");
  });

  it("shows an empty state when no real trigger rule exists", () => {
    renderPage();

    expect(screen.getByText("등록된 자동 전송 트리거가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("0개")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([false, true])("shows an unknown count and skeleton for a cold rules load (paused=%s)", (isPaused) => {
    mockUseMessageTriggerRules.mockReturnValue({ data: undefined, isPending: true, isLoading: !isPaused, isError: false, isFetching: !isPaused, isPaused, status: "pending", fetchStatus: isPaused ? "paused" : "fetching" });
    const { container } = renderPage();
    expect(screen.getByText("—개")).toBeInTheDocument();
    expect(screen.queryByText("0개")).not.toBeInTheDocument();
    expect(screen.queryByText("등록된 자동 전송 트리거가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_items_loading_row"]')).toBeInTheDocument();
  });

  it("preserves the empty state for disabled pending rules that are not paused", () => {
    mockUseMessageTriggerRules.mockReturnValue({ data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: false, status: "pending", fetchStatus: "idle" });
    renderPage();
    expect(screen.getByText("0개")).toBeInTheDocument();
    expect(screen.getByText("등록된 자동 전송 트리거가 없습니다.")).toBeInTheDocument();
  });

  it("keeps cached rules and count during a paused refetch", () => {
    mockUseMessageTriggerRules.mockReturnValue({ data: [createRule()], isLoading: false, isError: false, isPaused: true });
    const { container } = renderPage();
    expect(screen.getByText("실제 서비스 시작 규칙")).toBeInTheDocument();
    expect(screen.getByText("1개")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_items_loading_row"]')).not.toBeInTheDocument();
  });

  it("shows an unavailable count and retries a failed first rules load", () => {
    const refetch = jest.fn();
    mockUseMessageTriggerRules.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch });
    renderPage();
    expect(screen.getByText("—개")).toBeInTheDocument();
    expect(screen.queryByText("0개")).not.toBeInTheDocument();
    expect(screen.queryByText("등록된 자동 전송 트리거가 없습니다.")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(alert).toHaveTextContent("자동 전송 트리거를 불러오지 못했습니다.");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("retains a cached successful zero count after a failed refetch", () => {
    mockUseMessageTriggerRules.mockReturnValue({ data: [], isLoading: false, isError: true, isFetching: false, refetch: jest.fn() });
    renderPage();
    expect(screen.getByText("0개")).toBeInTheDocument();
    expect(screen.queryByText("—개")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("등록된 자동 전송 트리거가 없습니다.")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps cached rules and count above a retryable inline notice (fetching=%s)", (isFetching) => {
    const refetch = jest.fn();
    mockUseMessageTriggerRules.mockReturnValue({ data: [createRule()], isLoading: false, isError: true, isFetching, refetch });
    renderPage();
    const alert = screen.getByRole("alert");
    const row = screen.getByText("실제 서비스 시작 규칙");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("1개")).toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "다시 시도" });
    if (isFetching) {
      expect(retry).toBeDisabled();
    } else {
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);
    }
  });

  // M5: a branchless (system) rule is never editable (content is fixed), but this branch may
  // still opt out of it — the toggle stays live and routes through branch activation, never the
  // content DTO. Only isLockedByGlobal disables it (covered above).
  it("hides the edit affordance but keeps the toggle live for a branchless system rule (M5)", async () => {
    const onEdit = jest.fn();
    const rule = createRule({ id: "rule-system", branchId: null, name: "수동 발송 규칙" });
    mockUseMessageTriggerRules.mockReturnValue({ data: [rule], isError: false, isLoading: false });

    renderPage(onEdit);

    await screen.findByText("수동 발송 규칙");
    expect(screen.queryByRole("button", { name: "수동 발송 규칙 설정" })).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();

    const toggle = screen.getByRole("switch", { name: "수동 발송 규칙 비활성화" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(branchActivationMutate).toHaveBeenCalledWith({ id: "rule-system", dto: { isActive: false } });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("keeps the row toggle live for a branchless system rule when no onEdit is provided (M5)", async () => {
    const rule = createRule({ id: "rule-system", branchId: null, name: "수동 발송 규칙" });
    mockUseMessageTriggerRules.mockReturnValue({ data: [rule], isError: false, isLoading: false });

    renderPage();

    const row = await screen.findByRole("button", { name: /수동 발송 규칙/ });
    expect(row).toBeEnabled();
    fireEvent.click(row);
    expect(branchActivationMutate).toHaveBeenCalledWith({ id: "rule-system", dto: { isActive: false } });
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
