import { fireEvent, render as renderView, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import MessagesPage from "./page";

// Rule S5 (docs/business-rules.ko.md): a failed load is never shown as an empty
// list / 0 count / "not found". These tests mock every data hook, keep the real
// ListPanel (so `emptyState` and children both render) and the real
// QueryErrorState (never mocked), and assert both directions of each state.

const mockRefetchHistory = jest.fn();
const mockRefetchUpcoming = jest.fn();
const mockRefetchUserTemplates = jest.fn();
const mockRefetchSystemTemplates = jest.fn();
const mockRefetchSystemTemplate = jest.fn();

const mockUseMessageHistory = jest.fn();
const mockUseUpcomingJobs = jest.fn();
const mockUseMessageTemplates = jest.fn();
const mockUseSystemTemplates = jest.fn();
const mockUseSystemTemplate = jest.fn();
const mockUseGetAuthUser = jest.fn();

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => mockUseGetAuthUser(),
}));

// The gate has its own suite (MessageApprovalGate.test.tsx); here it must not
// interfere with the page's own load states.
jest.mock("@/components/app/messages/MessageApprovalGate", () => ({
  MessageApprovalGate: ({ children }: { children: ReactNode }) => <>{children}</>,
  useMessageSenderApproval: () => ({
    data: { approvalStatus: "approved", isApproved: true, canRequest: false },
    isLoading: false,
  }),
}));

jest.mock("@/features/message-templates/hooks/use-message-templates", () => ({
  useMessageTemplates: () => mockUseMessageTemplates(),
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
  useSystemTemplates: () => mockUseSystemTemplates(),
  useUpdateSystemTemplate: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: () => mockUseMessageHistory(),
  useUpcomingMessageTriggerJobs: () => mockUseUpcomingJobs(),
  useRetryMessageHistory: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCancelUpcomingMessageTriggerJob: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// Compact mode so useSplitLayoutSelection never auto-selects the first row;
// list and detail children both render. ListPanel itself stays real.
jest.mock("@/components/app/v3", () => {
  const React = jest.requireActual("react");
  const actual = jest.requireActual("@/components/app/v3");

  return {
    ...actual,
    SplitLayout: ({
      children,
      onModeChange,
    }: {
      children: ReactNode;
      onModeChange?: (mode: "desktop" | "compact") => void;
    }) => {
      React.useLayoutEffect(() => {
        onModeChange?.("compact");
      }, [onModeChange]);

      return <div data-testid="split-layout">{children}</div>;
    },
  };
});

jest.mock("@/components/ui/select", () => {
  const SelectChangeContext = createContext<(value: string) => void>(() => {});

  function Select({
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) {
    return <SelectChangeContext.Provider value={onValueChange}>{children}</SelectChangeContext.Provider>;
  }
  function SelectTrigger({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectValue() {
    return null;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    const onValueChange = useContext(SelectChangeContext);
    return (
      <button type="button" onClick={() => onValueChange(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderView(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

function buildUpcomingJob() {
  return {
    id: "job-1",
    ruleId: "rule-1",
    ruleName: "제공기록지 안내",
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    recipientType: "CLIENT",
    recipientPhone: "010-1111-2222",
    templateKey: "SERVICE_INFO",
    status: "pending",
    scheduledFor: "2026-08-20T01:00:00.000Z",
    sentAt: null,
    canceledAt: null,
    cancelReason: null,
    clientId: 1,
    employeeScheduleId: null,
    payload: {
      clientId: 1,
      clientName: "김서연",
      memberId: "member-1",
      recipientName: "김서연",
      recipientPhone: "010-1111-2222",
      templateVariables: {},
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function buildHistoryRecord() {
  return {
    id: 101,
    provider: "aligo_sms",
    templateKey: "SERVICE_INFO",
    triggerJobId: null,
    receiver: "01055556666",
    clientId: 2,
    recipientPhone: "010-5555-6666",
    messageBody: "안내 메시지입니다.",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-08-01T00:00:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: null,
    recipientName: "이하은",
    clientName: null,
    employeeName: null,
  };
}

function buildSystemTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "system-template-1",
    templateKey: "FUTURE_TEMPLATE",
    name: "새 서버 템플릿",
    description: "서버에서 추가된 템플릿",
    content: "서버 본문",
    requiredVariables: [],
    customVariables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

interface QueryState {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
}

function historyState({ data, isError = false, isFetching = false }: QueryState = {}) {
  mockUseMessageHistory.mockReturnValue({
    data,
    isLoading: false,
    isError,
    isFetching,
    refetch: mockRefetchHistory,
  });
}

function upcomingState({ data, isError = false, isFetching = false }: QueryState = {}) {
  mockUseUpcomingJobs.mockReturnValue({
    data,
    isLoading: false,
    isError,
    isFetching,
    refetch: mockRefetchUpcoming,
  });
}

function userTemplatesState({ data, isError = false, isFetching = false }: QueryState = {}) {
  mockUseMessageTemplates.mockReturnValue({
    data,
    isLoading: false,
    isError,
    isFetching,
    refetch: mockRefetchUserTemplates,
  });
}

function systemTemplatesState({ data, isError = false, isFetching = false }: QueryState = {}) {
  mockUseSystemTemplates.mockReturnValue({
    data,
    isLoading: false,
    isError,
    isFetching,
    refetch: mockRefetchSystemTemplates,
  });
}

function systemTemplateDetailState({ data, isError = false, isFetching = false }: QueryState = {}) {
  mockUseSystemTemplate.mockReturnValue({
    data,
    isLoading: false,
    isError,
    isFetching,
    refetch: mockRefetchSystemTemplate,
  });
}

function goToHistorySection() {
  fireEvent.click(screen.getAllByRole("button", { name: "발송 기록" })[0]);
}

function getZone(zone: "upcoming" | "past") {
  return document.querySelector(
    `[data-component="desktop_messages_sections_split-layout_list-panel-3_zone-${zone}"]`,
  ) as HTMLElement | null;
}

function getCount(dataComponent: string) {
  return document.querySelector(`[data-component="${dataComponent}"]`);
}

const PILL = "desktop_messages_sections_history-list-count";
const UPCOMING_COUNT = "desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_count";
const PAST_COUNT = "desktop_messages_sections_split-layout_list-panel-3_zone-past_count";

function getRetryButton(scope: HTMLElement) {
  return within(scope).getByRole("button", { name: "다시 시도" });
}

beforeEach(() => {
  document.cookie = "selected_branch_id=branch-test; path=/";
  jest.clearAllMocks();
  mockUseGetAuthUser.mockReturnValue({
    data: { id: "owner-1", role: "owner" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  });
  historyState({ data: [] });
  upcomingState({ data: [] });
  userTemplatesState({ data: [] });
  systemTemplatesState({ data: [] });
  systemTemplateDetailState();
});

describe("messages page 발송 기록 — send history load failure", () => {
  it("shows a retryable failure state, not 0건 or the empty text, when history failed with no cached data", () => {
    historyState({ isError: true });
    upcomingState({ data: [] });

    render(<MessagesPage />);
    goToHistorySection();

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("발송 기록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(getZone("past")).toContainElement(alert);
    expect(getCount(PILL)?.textContent).toBe("—건");
    expect(getCount(PILL)?.textContent).not.toContain("0건");
    expect(getCount(PAST_COUNT)?.textContent).toBe("—");
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    // The upcoming zone loaded fine and is empty: that stays a real 0.
    expect(getCount(UPCOMING_COUNT)?.textContent).toBe("0");

    fireEvent.click(getRetryButton(alert));
    expect(mockRefetchHistory).toHaveBeenCalledTimes(1);
    expect(mockRefetchUpcoming).not.toHaveBeenCalled();
  });

  it("keeps the empty text and a real 0건, with no alert, when both queries succeeded empty", () => {
    render(<MessagesPage />);
    goToHistorySection();

    expect(screen.getByText("표시할 메시지가 없습니다.")).toBeInTheDocument();
    expect(getCount(PILL)?.textContent).toBe("0건");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached history rows and the upcoming zone, with one inline notice, when a refetch failed", () => {
    historyState({ data: [buildHistoryRecord()], isError: true });
    upcomingState({ data: [buildUpcomingJob()] });

    render(<MessagesPage />);
    goToHistorySection();

    expect(within(getZone("past") as HTMLElement).getByText("이하은")).toBeInTheDocument();
    expect(within(getZone("upcoming") as HTMLElement).getByText("김서연")).toBeInTheDocument();
    expect(getCount(PILL)?.textContent).toBe("2건");

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(alerts[0]).toHaveAttribute("data-size", "inline");

    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchHistory).toHaveBeenCalledTimes(1);
    expect(mockRefetchUpcoming).not.toHaveBeenCalled();
  });

  it("disables the cached-data notice's retry while the refetch is in flight", () => {
    historyState({ data: [buildHistoryRecord()], isError: true, isFetching: true });

    render(<MessagesPage />);
    goToHistorySection();

    expect(getRetryButton(screen.getByRole("alert"))).toBeDisabled();
  });

  it("does not let a history failure break the 예정 tab, which only shows upcoming jobs", () => {
    historyState({ isError: true });
    upcomingState({ data: [buildUpcomingJob()] });

    render(<MessagesPage />);
    goToHistorySection();
    fireEvent.click(screen.getByRole("button", { name: "예정" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(getZone("upcoming") as HTMLElement).getByText("김서연")).toBeInTheDocument();
    expect(getCount(PILL)?.textContent).toBe("1건");
  });
});

describe("messages page 발송 기록 — upcoming scheduled sends load failure", () => {
  it("shows an inline failure state and a — count, not 0 or the empty text, when upcoming failed with no cache", () => {
    historyState({ data: [buildHistoryRecord()] });
    upcomingState({ isError: true });

    render(<MessagesPage />);
    goToHistorySection();

    const upcomingZone = getZone("upcoming") as HTMLElement;
    const alert = within(upcomingZone).getByRole("alert");
    expect(within(alert).getByText("예정된 발송을 불러오지 못했습니다")).toBeInTheDocument();
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(getCount(UPCOMING_COUNT)?.textContent).toBe("—");
    expect(getCount(UPCOMING_COUNT)?.textContent).not.toBe("0");
    expect(getCount(PILL)?.textContent).toBe("—건");
    expect(screen.queryByText("예정된 발송이 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    // The history side loaded and stays visible.
    expect(within(getZone("past") as HTMLElement).getByText("이하은")).toBeInTheDocument();

    fireEvent.click(getRetryButton(alert));
    expect(mockRefetchUpcoming).toHaveBeenCalledTimes(1);
    expect(mockRefetchHistory).not.toHaveBeenCalled();
  });

  it("never shows the empty text on the 예정 tab while upcoming failed, even with history empty", () => {
    upcomingState({ isError: true });

    render(<MessagesPage />);
    goToHistorySection();
    fireEvent.click(screen.getByRole("button", { name: "예정" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("예정된 발송이 없습니다.")).not.toBeInTheDocument();
    expect(getCount(PILL)?.textContent).toBe("—건");
  });

  it("keeps 예정된 발송이 없습니다. and a real 0건, with no alert, when upcoming succeeded empty", () => {
    render(<MessagesPage />);
    goToHistorySection();
    fireEvent.click(screen.getByRole("button", { name: "예정" }));

    expect(screen.getByText("예정된 발송이 없습니다.")).toBeInTheDocument();
    expect(getCount(PILL)?.textContent).toBe("0건");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached jobs with one inline notice when the upcoming refetch failed", () => {
    historyState({ data: [buildHistoryRecord()] });
    upcomingState({ data: [buildUpcomingJob()], isError: true });

    render(<MessagesPage />);
    goToHistorySection();

    expect(within(getZone("upcoming") as HTMLElement).getByText("김서연")).toBeInTheDocument();
    expect(getCount(UPCOMING_COUNT)?.textContent).toBe("1");
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();

    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchUpcoming).toHaveBeenCalledTimes(1);
    expect(mockRefetchHistory).not.toHaveBeenCalled();
  });

  it("disables the notice's retry while the upcoming refetch is in flight", () => {
    upcomingState({ data: [buildUpcomingJob()], isError: true, isFetching: true });

    render(<MessagesPage />);
    goToHistorySection();

    expect(getRetryButton(screen.getByRole("alert"))).toBeDisabled();
  });

  it("uses one notice whose retry refetches both queries when both have cached data and both failed", () => {
    historyState({ data: [buildHistoryRecord()], isError: true });
    upcomingState({ data: [buildUpcomingJob()], isError: true });

    render(<MessagesPage />);
    goToHistorySection();

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchHistory).toHaveBeenCalledTimes(1);
    expect(mockRefetchUpcoming).toHaveBeenCalledTimes(1);
  });
});

describe("messages page 템플릿 — template list load failure", () => {
  function openBranchTemplates() {
    fireEvent.click(screen.getByRole("button", { name: "지점 템플릿" }));
  }

  it("shows a retryable failure state, not 등록된 지점 템플릿이 없습니다., when branch templates failed with no cache", () => {
    userTemplatesState({ isError: true });

    render(<MessagesPage />);
    openBranchTemplates();

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("지점 템플릿을 불러오지 못했습니다")).toBeInTheDocument();
    expect(alert).toHaveClass("pointer-events-auto");
    expect(screen.queryByText("등록된 지점 템플릿이 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(getRetryButton(alert));
    expect(mockRefetchUserTemplates).toHaveBeenCalledTimes(1);
    expect(mockRefetchSystemTemplates).not.toHaveBeenCalled();
  });

  it("keeps 등록된 지점 템플릿이 없습니다. with no alert when branch templates succeeded empty", () => {
    render(<MessagesPage />);
    openBranchTemplates();

    expect(screen.getByText("등록된 지점 템플릿이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached branch templates with one inline notice when the refetch failed", () => {
    userTemplatesState({
      data: [{ id: "tpl-1", name: "내 지점 템플릿", variables: [] }],
      isError: true,
    });

    render(<MessagesPage />);
    openBranchTemplates();

    expect(screen.getByText("내 지점 템플릿")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("등록된 지점 템플릿이 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchUserTemplates).toHaveBeenCalledTimes(1);
  });

  it("does not show the branch-template failure on the built-in tab", () => {
    userTemplatesState({ isError: true });
    systemTemplatesState({ data: [buildSystemTemplate()] });

    render(<MessagesPage />);

    expect(screen.getByText("새 서버 템플릿")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retryable failure state when the built-in templates failed with no cache", () => {
    systemTemplatesState({ isError: true });

    render(<MessagesPage />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("기본 템플릿을 불러오지 못했습니다")).toBeInTheDocument();
    expect(alert).toHaveClass("pointer-events-auto");
    expect(screen.queryByText("등록된 기본 템플릿이 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(getRetryButton(alert));
    expect(mockRefetchSystemTemplates).toHaveBeenCalledTimes(1);
  });

  it("keeps cached built-in rows with one inline notice when the catalog refetch failed", () => {
    systemTemplatesState({ data: [buildSystemTemplate()], isError: true, isFetching: true });

    render(<MessagesPage />);

    expect(screen.getByText("새 서버 템플릿")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(getRetryButton(alerts[0])).toBeDisabled();
  });

  it("retries the catalog from the cached-rows notice once the refetch is idle", () => {
    systemTemplatesState({ data: [buildSystemTemplate()], isError: true });

    render(<MessagesPage />);

    fireEvent.click(getRetryButton(screen.getByRole("alert")));
    expect(mockRefetchSystemTemplates).toHaveBeenCalledTimes(1);
  });

  it("shows no alert when the built-in catalog loaded", () => {
    systemTemplatesState({ data: [buildSystemTemplate()] });

    render(<MessagesPage />);

    expect(screen.getByText("새 서버 템플릿")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("messages page 템플릿 — selected built-in template detail load failure", () => {
  const template = buildSystemTemplate();

  it("shows a retryable failure state in the templates editor when the detail failed with no cache", () => {
    systemTemplatesState({ data: [template] });
    systemTemplateDetailState({ isError: true });

    render(<MessagesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "템플릿" })[0]);
    fireEvent.click(screen.getByText("새 서버 템플릿"));

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("선택한 템플릿 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "템플릿 내용" })).not.toBeInTheDocument();

    fireEvent.click(getRetryButton(alert));
    expect(mockRefetchSystemTemplate).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor and shows one inline notice when a cached detail's refetch failed", () => {
    systemTemplatesState({ data: [template] });
    systemTemplateDetailState({ data: template, isError: true });

    render(<MessagesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "템플릿" })[0]);
    fireEvent.click(screen.getByText("새 서버 템플릿"));

    expect(screen.getByRole("textbox", { name: "템플릿 내용" })).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();

    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchSystemTemplate).toHaveBeenCalledTimes(1);
  });

  it("shows no alert and the editor when the detail loaded", () => {
    systemTemplatesState({ data: [template] });
    systemTemplateDetailState({ data: template });

    render(<MessagesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "템플릿" })[0]);
    fireEvent.click(screen.getByText("새 서버 템플릿"));

    expect(screen.getByRole("textbox", { name: "템플릿 내용" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the list-item preview with an inline notice in the send section when the detail failed", () => {
    systemTemplatesState({ data: [template] });
    systemTemplateDetailState({ isError: true });

    render(<MessagesPage />);
    fireEvent.click(screen.getByText("새 서버 템플릿"));

    expect(screen.getByText("선택한 템플릿의 내용을 확인하세요.")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();

    fireEvent.click(getRetryButton(alerts[0]));
    expect(mockRefetchSystemTemplate).toHaveBeenCalledTimes(1);
  });

  it("shows no alert in the send section when the detail loaded", () => {
    systemTemplatesState({ data: [template] });
    systemTemplateDetailState({ data: template });

    render(<MessagesPage />);
    fireEvent.click(screen.getByText("새 서버 템플릿"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
