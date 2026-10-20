import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MESSAGE_JOB_CANCEL_COPY,
  MESSAGE_JOB_RESEND_COPY,
  createProblemDetails,
} from "@babyjamjam/shared";

import {
  useCancelMessageTriggerJob,
  useMessageHistory,
  useResendMessageTriggerJob,
  useRetryMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { toast } from "@/hooks/use-toast";
import { MessagesHistoryPage } from "../MessagesDataPages";

// jsdom lacks PointerEvent (the touch tap needs pointerType) and ResizeObserver (Radix Popper).
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventPolyfill, configurable: true });
  }
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: jest.fn(),
  useRetryMessageHistory: jest.fn(),
  useResendMessageTriggerJob: jest.fn(),
  useUpcomingMessageTriggerJobs: jest.fn(),
  useCancelMessageTriggerJob: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

const mockUseMessageHistory = useMessageHistory as jest.Mock;
const mockUseRetryMessageHistory = useRetryMessageHistory as jest.Mock;
const mockUseResendMessageTriggerJob = useResendMessageTriggerJob as jest.Mock;
const mockUseUpcomingMessageTriggerJobs = useUpcomingMessageTriggerJobs as jest.Mock;
const mockUseCancelMessageTriggerJob = useCancelMessageTriggerJob as jest.Mock;
const mockToast = toast as jest.Mock;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/messages/history",
}));

let mockAuthBranchRole = "manager";
let mockAuthRole = "user";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: mockAuthRole, branchRole: mockAuthBranchRole },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

const cancelableJob = {
  id: "job-1",
  ruleId: "rule-1",
  ruleName: "서비스 안내",
  eventType: "SERVICE_START",
  offsetType: "BEFORE_DAYS",
  offsetDays: 1,
  recipientType: "CLIENT",
  recipientPhone: "01012345678",
  templateKey: "SERVICE_INFO",
  status: "pending",
  scheduledFor: "2026-07-17T01:00:00.000Z",
  sentAt: null,
  canceledAt: null,
  cancelReason: null,
  clientId: 1,
  employeeScheduleId: null,
  payload: {
    memberId: "member-1",
    recipientName: "김고객",
    recipientPhone: "01012345678",
    templateVariables: {},
  },
  createdAt: "2026-07-16T01:00:00.000Z",
  updatedAt: "2026-07-16T01:00:00.000Z",
};

// message_log-backed manual scheduled entry: carries a synthetic
// manual-sms:<logId> ruleId (see backend
// MessageTriggerService.listManualScheduledSmsLogs), so no cancel action.
const manualScheduledJob = {
  ...cancelableJob,
  id: "job-2",
  ruleId: "manual-sms:55",
  ruleName: "",
  payload: {
    ...cancelableJob.payload,
    recipientName: "박고객",
  },
};

const sentRecord = {
  id: 1,
  templateKey: "CLIENT_GREETING",
  triggerJobId: null,
  receiver: "01012345678",
  clientId: 1,
  recipientPhone: "01012345678",
  messageBody: "안녕하세요",
  variables: {},
  status: "sent",
  aligoMid: null,
  errorMessage: null,
  attempts: 1,
  lastAttemptAt: "2026-07-16T01:00:00.000Z",
  nextRetryAt: null,
  createdAt: "2026-07-16T01:00:00.000Z",
  updatedAt: "2026-07-16T01:00:00.000Z",
  ruleId: null,
  ruleName: null,
  eventType: "CLIENT_CREATED",
  offsetType: "IMMEDIATE",
  offsetDays: 0,
  scheduledFor: null,
  recipientType: "CLIENT",
  recipientName: "김문자",
  clientName: "김문자",
  employeeName: null,
  provider: "aligo_sms",
};

const canceledRecord = {
  ...sentRecord,
  id: 2,
  status: "canceled",
  errorMessage: "사용자가 예정된 발송을 취소했습니다.",
  recipientName: "취소 고객",
  clientName: "취소 고객",
  lastAttemptAt: "2026-07-16T02:00:00.000Z",
};

function mockNoCancelMutation() {
  mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
}

function mockNoRetryMutation() {
  mockUseRetryMessageHistory.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
}

function mockNoResendMutation() {
  mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
}

describe("mobile message data pages (merged 발송 기록 screen)", () => {
  beforeEach(() => {
    mockUseMessageHistory.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockNoCancelMutation();
    mockNoRetryMutation();
    mockNoResendMutation();
    mockToast.mockReset();
  });

  it.each(["checking", "exhausted"])("renders visible detail-header lookup %s while keeping the list failed", async historyLookup => {
    mockUseMessageHistory.mockReturnValue({ data: [{ ...sentRecord, status: "failed", variables: { historyLookup } }], isLoading: false, isError: false });
    const { container } = render(<MessagesHistoryPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /김문자/ }));
    const header = container.querySelector('[data-component$="_detail-pane_header_status"]');
    expect(header).toHaveTextContent(historyLookup === "checking" ? "확인 중" : "확인 필요");
    expect(container.querySelector('[data-component$="_body_item_status"]')).toHaveTextContent("발송 실패");
  });

  it("renders a needs_setup history row as 추가 정보 필요 with the warning tone instead of throwing", async () => {
    mockUseMessageHistory.mockReturnValue({
      data: [{ ...sentRecord, status: "needs_setup", triggerJobId: "job-9", messageBody: "", errorMessage: "수신자 연락처가 필요합니다." }],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<MessagesHistoryPage />);
    const rowBadge = container.querySelector('[data-component$="_body_item_status"]');
    expect(rowBadge).toHaveTextContent("추가 정보 필요");
    expect(rowBadge).toHaveClass("bg-status-warning");

    await userEvent.setup().click(screen.getByRole("button", { name: /김문자/ }));
    const header = container.querySelector('[data-component$="_detail-pane_header_status"]');
    expect(header).toHaveTextContent("추가 정보 필요");
  });

  it.each(["processing", "dispatching"] as const)(
    "labels a %s upcoming job 발송 중 with the info tone",
    (status) => {
      mockUseUpcomingMessageTriggerJobs.mockReturnValue({
        isLoading: false,
        isError: false,
        data: [{ ...cancelableJob, status }],
      });

      const { container } = render(<MessagesHistoryPage />);

      const badge = container.querySelector('[data-component$="_item-upcoming_status"]');
      expect(badge).not.toBeNull();
      expect(badge).toHaveTextContent("발송 중");
      expect(badge).toHaveClass("bg-status-info");
      expect(container.querySelector('[data-component$="_item-upcoming_cancel-action"]')).toBeNull();
    },
  );

  it("renders both zones with labelled dividers, soonest-first upcoming and most-recent-first past sends", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord],
    });

    const { container } = render(<MessagesHistoryPage />);

    const upcomingZone = container.querySelector('[data-component$="_zone-upcoming"]');
    const pastZone = container.querySelector('[data-component$="_zone-past"]');
    expect(upcomingZone).toBeInTheDocument();
    expect(pastZone).toBeInTheDocument();
    expect(upcomingZone!.compareDocumentPosition(pastZone!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 1건");
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(screen.getByText(/김문자/)).toBeInTheDocument();
    // ListCard header count reflects the combined visible total across zones.
    expect(container.querySelector('[data-component$="_content_list-card_header"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(screen.getByText("2건")).toBeInTheDocument();
  });

  it("keeps an empty zone visible at a zero count instead of hiding it", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 0건");
    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
  });

  it("keeps the past zone visible at a zero count too", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [cancelableJob] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 0건");
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 1건");
  });

  it("shows the skeleton panel, not the empty state, on a cold load with no cached data", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const { container } = render(<MessagesHistoryPage />);

    // Nothing is settled, so totalVisibleCount is 0 — but a loading panel must
    // never collapse into "표시할 메시지가 없습니다.".
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있습니다");
    // The filter pills must not publish confident zeros next to skeletons.
    expect(container.querySelectorAll('.filter-pill-skeleton')).toHaveLength(5);
  });

  it("shows a zone's error message with no fabricated count", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText("발송 예정 내역을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정");
    // The healthy zone is unaffected.
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
  });

  it("marks the card and upcoming-dependent filters unavailable when upcoming loading fails", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    const cardHeader = container.querySelector('[data-component$="_content_list-card_header"]') as HTMLElement;

    expect(cardHeader.querySelector('[data-count-state="unavailable"]')).toHaveAccessibleName("집계 실패");
    expect(container.querySelector('[data-component$="_zone-upcoming_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");

    expect(within(filterBar).getByRole("button", { name: /전체/ })).toHaveTextContent("집계 실패");
    expect(within(filterBar).getByRole("button", { name: /예정/ })).toHaveTextContent("집계 실패");
    expect(within(filterBar).getByRole("button", { name: /발송 성공/ })).toHaveTextContent("1");
    expect(within(filterBar).getByRole("button", { name: /발송 실패/ })).toHaveTextContent("0");
    expect(within(filterBar).getByRole("button", { name: /발송 취소/ })).toHaveTextContent("0");
  });

  it("marks the card and history-dependent filters unavailable when history loading fails", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [cancelableJob] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: true, data: undefined });

    const { container } = render(<MessagesHistoryPage />);
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    const cardHeader = container.querySelector('[data-component$="_content_list-card_header"]') as HTMLElement;

    expect(cardHeader.querySelector('[data-count-state="unavailable"]')).toHaveAccessibleName("집계 실패");
    expect(container.querySelector('[data-component$="_zone-past_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 1건");

    expect(within(filterBar).getByRole("button", { name: /전체/ })).toHaveTextContent("집계 실패");
    expect(within(filterBar).getByRole("button", { name: /예정/ })).toHaveTextContent("1");
    expect(within(filterBar).getByRole("button", { name: /발송 성공/ })).toHaveTextContent("집계 실패");
    expect(within(filterBar).getByRole("button", { name: /발송 실패/ })).toHaveTextContent("집계 실패");
    expect(within(filterBar).getByRole("button", { name: /발송 취소/ })).toHaveTextContent("집계 실패");
  });

  it("shows the past zone's error message while the upcoming zone still loads", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다."),
      data: undefined,
    });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText("메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("alert").querySelector('[data-slot="title"]')).toHaveTextContent("발송 기록을 불러오지 못했습니다.");
    expect(screen.getByRole("alert").querySelector('[data-slot="description"]')).toHaveTextContent("메시지 발송 기록이 100페이지");
    expect(container.querySelector('[data-component$="_zone-past_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
  });

  it("uses a safe Korean fallback for transient history diagnostics", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [] });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("HTTP 500 provider token=secret"),
      data: undefined,
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByText("발송 기록을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/provider token=secret/)).not.toBeInTheDocument();
  });

  it("collapses to the empty state only when both zones are settled and empty", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-upcoming"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).not.toBeInTheDocument();
    expect(screen.getByText("표시할 메시지가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("0건")).toBeInTheDocument();
  });

  it.each(["upcoming", "past"] as const)("retries the failed %s zone without showing empty data", async (zone) => {
    const refetch = jest.fn();
    const otherRefetch = jest.fn();
    const failedHook = zone === "upcoming" ? mockUseUpcomingMessageTriggerJobs : mockUseMessageHistory;
    const otherHook = zone === "upcoming" ? mockUseMessageHistory : mockUseUpcomingMessageTriggerJobs;
    failedHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch });
    otherHook.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: otherRefetch });
    const { container } = render(<MessagesHistoryPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(alert).toHaveTextContent(zone === "upcoming" ? "발송 예정 내역을 불러오지 못했습니다." : "발송 기록을 불러오지 못했습니다.");
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    expect(container.querySelector(`[data-component$="_zone-${zone}_header_count"]`)).not.toBeInTheDocument();
    await userEvent.setup().click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(otherRefetch).not.toHaveBeenCalled();
  });

  it.each(["upcoming", "past"] as const)("keeps cached %s rows below one inline notice and disables its in-flight retry", async (zone) => {
    const refetch = jest.fn();
    const failedHook = zone === "upcoming" ? mockUseUpcomingMessageTriggerJobs : mockUseMessageHistory;
    const data = zone === "upcoming" ? [cancelableJob] : [sentRecord];
    failedHook.mockReturnValue({ data, isLoading: false, isError: true, isFetching: false, refetch });
    const { container, rerender } = render(<MessagesHistoryPage />);
    const alert = screen.getByRole("alert");
    const row = screen.getByText(zone === "upcoming" ? "김고객" : "김문자");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-count-state="unavailable"]')).toBeInTheDocument();
    await userEvent.setup().click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    failedHook.mockReturnValue({ data, isLoading: false, isError: true, isFetching: true, refetch });
    rerender(<MessagesHistoryPage />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(row).toBeInTheDocument();
  });

  it.each(["upcoming", "past"] as const)("keeps failed cached %s data visible while its sibling loads", (zone) => {
    const failedHook = zone === "upcoming" ? mockUseUpcomingMessageTriggerJobs : mockUseMessageHistory;
    const otherHook = zone === "upcoming" ? mockUseMessageHistory : mockUseUpcomingMessageTriggerJobs;
    failedHook.mockReturnValue({ data: zone === "upcoming" ? [cancelableJob] : [sentRecord], isLoading: false, isError: true, isFetching: false, refetch: jest.fn() });
    otherHook.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<MessagesHistoryPage />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(screen.getByText(zone === "upcoming" ? "김고객" : "김문자")).toBeInTheDocument();
  });

  it("keeps cached history rows and counts while the upcoming query loads", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText(/김문자/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(0);
    expect(container.querySelector('[data-component$="_zone-past_header_count"]')).toHaveTextContent("1건");
    expect(container.querySelectorAll('.filter-pill-skeleton')).toHaveLength(2);

    for (const suffix of [
      "_zone-upcoming_header_count",
      "_content_list-card_header_count",
    ]) {
      const node = container.querySelector(`[data-component$="${suffix}"]`);
      expect(node).toBeInTheDocument();
      expect(node).toHaveAttribute("data-source-component", "ListCountSkeleton");
      expect(node?.textContent ?? "").not.toMatch(/\d/);
    }
  });

  it("keeps settled upcoming rows and counts while the history query loads", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [cancelableJob] });
    mockUseMessageHistory.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(0);
    expect(container.querySelector('[data-component$="_zone-upcoming_header_count"]')).toHaveTextContent("1건");
    expect(container.querySelectorAll('.filter-pill-skeleton')).toHaveLength(4);
  });

  it("treats both cold paused queries as loading, not successful empty results", () => {
    const paused = { data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" };
    mockUseUpcomingMessageTriggerJobs.mockReturnValue(paused);
    mockUseMessageHistory.mockReturnValue(paused);
    const { container } = render(<MessagesHistoryPage />);
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있습니다");
    expect(container.querySelectorAll('.filter-pill-skeleton')).toHaveLength(5);
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(4);
  });

  it.each(["upcoming", "past"] as const)("keeps healthy %s rows and count during its sibling's cold retry", async (zone) => {
    const healthyHook = zone === "upcoming" ? mockUseUpcomingMessageTriggerJobs : mockUseMessageHistory;
    const siblingHook = zone === "upcoming" ? mockUseMessageHistory : mockUseUpcomingMessageTriggerJobs;
    const refetch = jest.fn();
    healthyHook.mockReturnValue({ data: zone === "upcoming" ? [cancelableJob] : [sentRecord], isLoading: false, isError: false });
    siblingHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const { container, rerender } = render(<MessagesHistoryPage />);
    const rowText = zone === "upcoming" ? "김고객" : "김문자";
    const count = () => container.querySelector(`[data-component$="_zone-${zone}_header_count"]`);
    expect(screen.getByText(rowText)).toBeInTheDocument();
    expect(count()).toHaveTextContent("1건");
    await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    siblingHook.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, isError: false, refetch });
    rerender(<MessagesHistoryPage />);
    expect(screen.getByText(rowText)).toBeInTheDocument();
    expect(count()).toHaveTextContent("1건");
    expect(container.querySelector('[data-component$="_content_list-card_header_count"]')).toHaveAttribute("data-source-component", "ListCountSkeleton");
  });

  it("preserves the empty state for disabled pending queries that are not paused", () => {
    const disabled = { data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: false, status: "pending", fetchStatus: "idle" };
    mockUseUpcomingMessageTriggerJobs.mockReturnValue(disabled);
    mockUseMessageHistory.mockReturnValue(disabled);
    render(<MessagesHistoryPage />);
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.getByText("표시할 메시지가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not gate a visible settled zone on a filtered-away loading zone", async () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [cancelableJob], isLoading: false, isError: false });
    mockUseMessageHistory.mockReturnValue({ data: undefined, isLoading: false, isPaused: true, isError: false });
    const { container } = render(<MessagesHistoryPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /예정/ }));
    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_content_list-card_header_count"]')).toHaveTextContent("1건");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the all pill loading when filtered-away history is cold paused", async () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [cancelableJob], isLoading: false, isError: false });
    mockUseMessageHistory.mockReturnValue({ data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" });

    const { container } = render(<MessagesHistoryPage />);
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    await userEvent.setup().click(within(filterBar).getByRole("button", { name: /^예정/ }));

    const allPill = within(filterBar).getByText("전체").closest("button");
    expect(allPill).toHaveClass("filter-pill-skeleton");
    expect(allPill).toHaveAttribute("aria-hidden", "true");
    expect(allPill?.querySelector(".count")).not.toBeInTheDocument();
    const upcomingPill = within(filterBar).getByRole("button", { name: /^예정/ });
    expect(upcomingPill).not.toHaveClass("filter-pill-skeleton");
    expect(upcomingPill).toHaveTextContent("1");
    expect(container.querySelector('[data-component$="_content_list-card_header_count"]')).toHaveTextContent("1건");
    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the all pill loading when filtered-away upcoming is on its first load", async () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false, isFetching: true, isPaused: false, status: "pending", fetchStatus: "fetching" });
    mockUseMessageHistory.mockReturnValue({ data: [sentRecord], isLoading: false, isError: false });

    const { container } = render(<MessagesHistoryPage />);
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    await userEvent.setup().click(within(filterBar).getByRole("button", { name: /^발송 성공/ }));

    const allPill = within(filterBar).getByText("전체").closest("button");
    expect(allPill).toHaveClass("filter-pill-skeleton");
    expect(allPill).toHaveAttribute("aria-hidden", "true");
    expect(allPill?.querySelector(".count")).not.toBeInTheDocument();
    const sentPill = within(filterBar).getByRole("button", { name: /^발송 성공/ });
    expect(sentPill).not.toHaveClass("filter-pill-skeleton");
    expect(sentPill).toHaveTextContent("1");
    expect(container.querySelector('[data-component$="_content_list-card_header_count"]')).toHaveTextContent("1건");
    expect(screen.getByText("김문자")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps cached rows and counts during paused refetches", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [cancelableJob], isLoading: false, isPaused: true, isError: false });
    mockUseMessageHistory.mockReturnValue({ data: [sentRecord], isLoading: false, isPaused: true, isError: false });
    const { container } = render(<MessagesHistoryPage />);
    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(screen.getByText("김문자")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_content_list-card_header_count"]')).toHaveTextContent("2건");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows SMS history and excludes non-SMS provider records", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        sentRecord,
        {
          ...sentRecord,
          id: 2,
          provider: "aligo_alimtalk",
          templateKey: "CLIENT_WELCOME",
          recipientName: "김알림톡",
        },
      ],
    });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText(/김문자/)).toBeInTheDocument();
    expect(screen.queryByText("김알림톡")).not.toBeInTheDocument();
    // Scoped to the past zone: the "발송" status filter chip now reads
    // "발송 성공" too (see MESSAGE_RECORD_STATUS_FILTER_LABELS), so an
    // unscoped query would also match that chip, not just this row's badge.
    const pastZone = container.querySelector('[data-component$="_zone-past"]') as HTMLElement;
    expect(within(pastZone).getByText("발송 성공")).toBeInTheDocument();
  });

  it("keeps the history status badge in the trailing column", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord],
    });

    const { container } = render(<MessagesHistoryPage />);
    const historyRow = container.querySelector(
      '[data-component$="_content_list-card_body_item"]',
    ) as HTMLElement;
    const rowCopy = historyRow.querySelector(".message-data-row-copy");
    const statusBadge = historyRow.querySelector('[data-component$="_item_status"]');

    expect(rowCopy).toHaveClass("message-data-row-copy-split");
    expect(statusBadge?.parentElement).toHaveClass("message-data-status-group");
  });

  it("shows the recipient before the sent date on one metadata row", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord],
    });

    const { container } = render(<MessagesHistoryPage />);
    const metadataRow = container.querySelector(".message-data-row-meta") as HTMLElement;

    expect(metadataRow).toHaveAttribute("data-slot", "row-meta");
    expect(Array.from(metadataRow.children).map((element) => element.tagName)).toEqual([
      "P",
      "SMALL",
    ]);
    expect(metadataRow.children[0]).toHaveTextContent("김문자");
    expect(metadataRow.children[1]).toHaveTextContent("7. 16.");
  });

  it("hides a canceled row's reason from the history list", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [canceledRecord],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByText("취소 고객")).toBeInTheDocument();
    expect(screen.queryByText(`사유: ${canceledRecord.errorMessage}`)).not.toBeInTheDocument();
  });

  it("shows a 취소 사유 row in the history detail view for a canceled record", async () => {
    const user = userEvent.setup();
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [canceledRecord],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: /취소 고객/ }));

    expect(screen.getByText("취소 정보")).toBeInTheDocument();
    expect(screen.getByText("사유")).toBeInTheDocument();
    expect(screen.getByText(canceledRecord.errorMessage)).toBeInTheDocument();
  });

  it("does not add a cancel action to a manual scheduled row (synthetic manual-sms: rule id)", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [manualScheduledJob],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByText("박고객")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action })).not.toBeInTheDocument();
  });

  it("adds a cancel action to a pending trigger job row (has a rule id)", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action })).toBeInTheDocument();
  });

  it("filters to zone 1 only for the upcoming filter, and to matching zone 2 rows for a status filter", async () => {
    const user = userEvent.setup();
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord, canceledRecord],
    });

    const { container } = render(<MessagesHistoryPage />);

    // "upcoming" filter: zone 1 only, zone 2 hidden entirely.
    await user.click(screen.getByRole("button", { name: /^예정/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: /^전체/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^전체/ })).not.toHaveClass("filter-pill-skeleton");

    // "발송 취소" filter: zone 1 hidden, zone 2 shows only the canceled row.
    // Scoped to the filter bar: the upcoming zone's still-visible cancel-row
    // button (MESSAGE_JOB_CANCEL_COPY.action) is also exactly "발송 취소",
    // and the filter chip's label now shares that wording too (see
    // MESSAGE_RECORD_STATUS_FILTER_LABELS), so an unscoped query would match both.
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    await user.click(within(filterBar).getByRole("button", { name: /^발송 취소/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).not.toBeInTheDocument();
    expect(screen.getByText("취소 고객")).toBeInTheDocument();
    expect(screen.queryByText(/김문자/)).not.toBeInTheDocument();

    expect(within(filterBar).getByRole("button", { name: /^전체/ })).toHaveTextContent("3");
    expect(within(filterBar).getByRole("button", { name: /^전체/ })).not.toHaveClass("filter-pill-skeleton");

    // back to "전체": both zones return.
    await user.click(screen.getByRole("button", { name: /^전체/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(screen.getByText(/김문자/)).toBeInTheDocument();
  });

  it("keeps history search and date controls collapsed until the filter toggle is opened", async () => {
    const user = userEvent.setup();
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord],
    });

    const { container } = render(<MessagesHistoryPage />);
    const filterToggle = screen.getByRole("button", { name: "필터" });

    expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByPlaceholderText("고객명, 연락처, 템플릿, 내용 검색…")).not.toBeInTheDocument();

    const headerText = container.querySelector('[data-component$="_content_list-card_header"] .list-title-text');
    expect(headerText?.textContent?.indexOf("필터")).toBeGreaterThanOrEqual(0);
    expect(headerText?.textContent?.indexOf("필터")).toBeLessThan(headerText?.textContent?.indexOf("1건") ?? 0);

    await user.click(filterToggle);

    expect(filterToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "고객명, 연락처, 템플릿, 내용 검색" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("고객명, 연락처, 템플릿, 내용 검색…")).toBeInTheDocument();
    const filterPanel = container.querySelector('[data-slot="message-history-filters"]') as HTMLElement;
    expect(filterPanel.querySelector('[aria-label="발송 기간"]')).toBeInTheDocument();
    expect(filterPanel.querySelector('[aria-label="발송 연도"]')).toBeInTheDocument();
    expect(filterPanel.querySelector('[aria-label="발송 월"]')).toBeInTheDocument();
    expect(within(filterPanel).getByRole("button", { name: "필터 초기화" })).toHaveClass("w-1/2");
    expect(within(filterPanel).getByRole("button", { name: "필터 닫기" })).toHaveClass("w-1/2");
  });

  it("filters history by search while preserving the reset and close actions", async () => {
    const user = userEvent.setup();
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord, canceledRecord],
    });

    const { container } = render(<MessagesHistoryPage />);
    await user.click(screen.getByRole("button", { name: "필터" }));

    const search = screen.getByPlaceholderText("고객명, 연락처, 템플릿, 내용 검색…");
    await user.type(search, "김문자");
    expect(screen.getByText("김문자")).toBeInTheDocument();
    expect(screen.queryByText("취소 고객")).not.toBeInTheDocument();

    const filterPanel = container.querySelector('[data-slot="message-history-filters"]') as HTMLElement;
    const reset = within(filterPanel).getByRole("button", { name: "필터 초기화" });
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(search).toHaveValue("");
    expect(screen.getByText("취소 고객")).toBeInTheDocument();

    await user.click(within(filterPanel).getByRole("button", { name: "필터 닫기" }));
    expect(screen.queryByPlaceholderText("고객명, 연락처, 템플릿, 내용 검색…")).not.toBeInTheDocument();
  });

  it("hides cancel and resend from a plain branch user (both need BranchManagerGuard)", async () => {
    const user = userEvent.setup();
    mockAuthBranchRole = "user";
    try {
      mockUseUpcomingMessageTriggerJobs.mockReturnValue({
        isLoading: false,
        isError: false,
        data: [cancelableJob],
      });
      mockUseMessageHistory.mockReturnValue({
        isLoading: false,
        isError: false,
        data: [{ ...sentRecord, id: 78, status: "failed" as const, errorMessage: "실패" }],
      });

      render(<MessagesHistoryPage />);

      expect(screen.queryByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /김문자/ }));
      expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
    } finally {
      mockAuthBranchRole = "manager";
    }
  });

  it("confirms a failed history resend through the existing approval modal", async () => {
    const user = userEvent.setup();
    const failedRecord = {
      ...sentRecord,
      id: 77,
      status: "failed" as const,
      resentByLogId: null,
      retryBlockedByLogId: null,
      errorMessage: "등록되지 않은 발신번호입니다.",
    };
    const mutateAsync = jest.fn().mockResolvedValue({ ...failedRecord, status: "pending" });
    mockUseRetryMessageHistory.mockReturnValue({ mutateAsync, isPending: false });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [failedRecord],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: /김문자/ }));
    expect(screen.getByRole("button", { name: "재발송" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "재발송" }));
    expect(screen.getByRole("dialog", { name: "메시지를 다시 보낼까요?" })).toBeInTheDocument();

    const approveButton = document.querySelector('[data-component$="_retry-modal_approve"]');
    expect(approveButton).not.toBeNull();
    await user.click(approveButton as HTMLElement);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(77));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: "재발송 요청을 접수했어요",
      variant: "success",
    }));
  });

  it.each(["checking", "exhausted"])("shows a resent success badge in list and SlidingCard header despite %s lookup and never retries", async historyLookup => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn();
    mockUseRetryMessageHistory.mockReturnValue({ mutateAsync, isPending: false });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [{
      ...sentRecord, id: 77, status: "failed", resentByLogId: 78,
      variables: { historyLookup }, errorMessage: "등록되지 않은 발신번호입니다.",
    }] });
    const { container } = render(<MessagesHistoryPage />);
    const badge = container.querySelector('[data-component$="_body_item_status"]');
    expect(badge).toHaveTextContent("재발송됨");
    expect(badge).not.toHaveTextContent("발송 실패");
    expect(badge).toHaveClass("bg-status-success", "text-status-success-fg");
    expect(badge?.querySelector("svg")).toHaveClass("lucide-circle-check");
    await user.click(screen.getByRole("button", { name: /김문자/ }));
    const header = container.querySelector('[data-component$="_detail-pane_header_status"]');
    expect(header).toHaveTextContent("재발송됨");
    expect(header).toHaveClass("bg-status-success", "text-status-success-fg");
    expect(screen.queryByText(historyLookup === "checking" ? "확인 중" : "확인 필요")).not.toBeInTheDocument();
    expect(screen.getByText("실패 사유")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "재발송" });
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it.each([undefined, "checking", "exhausted"])("keeps a retry-blocked failure's normal label for %s lookup without retrying", async historyLookup => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn();
    mockUseRetryMessageHistory.mockReturnValue({ mutateAsync, isPending: false });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [{
      ...sentRecord, id: 77, status: "failed", resentByLogId: null, retryBlockedByLogId: 78,
      variables: { historyLookup },
    }] });
    const { container } = render(<MessagesHistoryPage />);
    expect(container.querySelector('[data-component$="_body_item_status"]')).toHaveTextContent("발송 실패");
    await user.click(screen.getByRole("button", { name: /김문자/ }));
    expect(container.querySelector('[data-component$="_detail-pane_header_status"]')).toHaveTextContent(
      historyLookup === "checking" ? "확인 중" : historyLookup === "exhausted" ? "확인 필요" : "발송 실패",
    );
    expect(screen.queryByText("재발송됨")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "재발송" });
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("opens the desktop-equivalent message detail when a history row is selected", async () => {
    const user = userEvent.setup();

    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{
        ...sentRecord,
        id: 3,
        templateKey: "service_record_link_sms",
        messageBody: "제공기록지 링크",
        lastAttemptAt: "2026-07-16T12:19:00.000Z",
      }],
    });

    const { container } = render(<MessagesHistoryPage />);

    const historyItem = container.querySelector('[data-component$="_content_list-card_body_item"]');

    expect(historyItem).not.toBeNull();
    expect(historyItem?.querySelector("strong")).toHaveTextContent("제공기록지 작성 링크");
    expect(historyItem?.querySelector("p")).toHaveTextContent(/김문자/);
    expect(historyItem).not.toHaveTextContent("01012345678");
    expect(screen.queryByText(/service_record_link_sms/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /제공기록지 작성 링크/ }));

    const detailPage = container.querySelector('[data-slot="detail-pane"]');
    const listPane = container.querySelector('[data-slot="list-pane"]');
    const detailPaneElement = detailPage as HTMLElement;

    expect(detailPage).toHaveAttribute("aria-hidden", "false");
    expect(listPane).toHaveAttribute("aria-hidden", "true");
    const closeButton = within(detailPage as HTMLElement).getByRole("button", {
      name: "발송 기록 목록으로 돌아가기",
    });

    expect(screen.getByText("발송 정보")).toBeInTheDocument();
    expect(screen.getAllByText("김문자")).not.toHaveLength(0);
    expect(screen.getByText("01012345678")).toBeInTheDocument();
    expect(screen.getAllByText("제공기록지 작성 링크")).not.toHaveLength(0);
    expect(detailPage).toHaveTextContent("발송 성공");
    expect(screen.getByText("제공기록지 링크")).toBeInTheDocument();

    const detailHero = detailPaneElement.querySelector('[data-slot="detail-hero"]');
    expect(detailHero).toBeInTheDocument();
    expect(detailPaneElement.querySelector('[data-component$="_content_icon"]')).toHaveClass(
      "h-[calc(46px*var(--glint-ui-scale,1))]",
      "w-[calc(46px*var(--glint-ui-scale,1))]",
    );
    expect(detailPaneElement.querySelector('[data-component$="_content_status"]')).not.toBeInTheDocument();
    expect(detailPaneElement.querySelector('[data-slot="detail-pane-header-trailing"]')).toHaveTextContent("발송 성공");

    await user.click(closeButton);

    expect(container.querySelector('[data-component$="_content_list-card_header"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(detailPage).toHaveAttribute("aria-hidden", "true");
    expect(listPane).toHaveAttribute("aria-hidden", "false");
  });

  it("cancels an upcoming trigger job through the confirm modal and shows success feedback", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn().mockResolvedValue({});
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));

    expect(screen.getByText(MESSAGE_JOB_CANCEL_COPY.confirmTitle)).toBeInTheDocument();

    // ApprovalTwoButtonModal renders through a Radix Portal (appended to
    // document.body), so it sits outside RTL's `container` subtree — query
    // the full document instead.
    const approveButton = document.querySelector('[data-component$="_cancel-modal_approve"]');
    expect(approveButton).not.toBeNull();
    await user.click(approveButton as HTMLElement);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith("job-1");
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: MESSAGE_JOB_CANCEL_COPY.success,
        variant: "success",
      }),
    );
  });

  it("shows failure feedback when the cancel mutation rejects, and leaves the row in place", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn().mockRejectedValue(new Error("already sent"));
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));
    const approveButton = document.querySelector('[data-component$="_cancel-modal_approve"]');
    expect(approveButton).not.toBeNull();
    await user.click(approveButton as HTMLElement);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: MESSAGE_JOB_CANCEL_COPY.failure,
          variant: "destructive",
        }),
      );
    });
    // The job row itself is untouched on failure — no query invalidation happened.
    expect(screen.getByText("김고객")).toBeInTheDocument();
  });

  it("dismissing the confirm modal does not call the cancel mutation", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn();
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));
    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.dismiss }));

    expect(screen.queryByText(MESSAGE_JOB_CANCEL_COPY.confirmTitle)).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  describe("추가 정보 필요 trigger-job resend (BJJ-444)", () => {
    const JOB_UUID = "8f14e45f-ceea-467a-9575-7b1a6f2f6c11";
    const SETUP_REASON = "수신자 연락처가 필요합니다.";
    const needsSetupJobRecord = {
      ...sentRecord,
      id: `job:${JOB_UUID}`,
      provider: "message_job",
      templateKey: "SERVICE_INFO",
      triggerJobId: JOB_UUID,
      status: "needs_setup" as const,
      errorMessage: SETUP_REASON,
      messageBody: "서비스 안내 메시지",
      recipientName: "설정 고객",
      clientName: "설정 고객",
    };

    function mockJobHistory(record: Record<string, unknown> = needsSetupJobRecord) {
      mockUseMessageHistory.mockReturnValue({ data: [record], isLoading: false, isError: false });
    }

    async function openJobDetail(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: /설정 고객/ }));
    }

    async function confirmResend(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "재발송" }));
      expect(screen.getByRole("dialog", { name: "메시지를 다시 보낼까요?" })).toBeInTheDocument();
      const approveButton = document.querySelector('[data-component$="_retry-modal_approve"]');
      expect(approveButton).not.toBeNull();
      await user.click(approveButton as HTMLElement);
    }

    it("shows the 추가 정보 필요 label, the reason row and a 재발송 button for a manager", async () => {
      const user = userEvent.setup();
      mockJobHistory();
      const { container } = render(<MessagesHistoryPage />);

      await openJobDetail(user);

      expect(container.querySelector('[data-component$="_detail-pane_header_status"]')).toHaveTextContent("추가 정보 필요");
      expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
      expect(screen.getByText(SETUP_REASON)).toBeInTheDocument();
      expect(screen.queryByText("실패 사유")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "재발송" })).toBeInTheDocument();
    });

    it.each([
      { level: "rule", extra: {}, title: "자동화 규칙이 꺼져 있어요", linkName: "규칙 보기 →", href: "/messages/automation?item=rule-1" },
      {
        level: "recipient",
        extra: { resendBlockedRecipient: { kind: "client", id: 10 } },
        title: "자동 문자가 꺼져 있어요",
        linkName: "고객 정보에서 켜기 →",
        href: "/clients?id=10",
      },
      { level: "branch", extra: {}, title: "지점 자동 전송이 꺼져 있어요", linkName: "자동화 설정 열기 →", href: "/messages/settings?item=trigger-dispatch" },
    ] as const)(
      "disables the 재발송 button, opens a card with a link on tap, and never resends for a $level block ($linkName)",
      async ({ level, extra, title, linkName, href }) => {
        const user = userEvent.setup();
        const mutateAsync = jest.fn();
        mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
        mockJobHistory({ ...needsSetupJobRecord, ruleId: "rule-1", ruleName: "서비스 안내 규칙", resendBlockedBy: level, ...extra });
        render(<MessagesHistoryPage />);

        await openJobDetail(user);

        const button = screen.getByRole("button", { name: "재발송" });
        expect(button).toBeDisabled();
        expect(screen.queryByText(title)).not.toBeInTheDocument();

        await user.click(button);
        expect(screen.queryByRole("dialog", { name: "메시지를 다시 보낼까요?" })).not.toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();

        // A touch tap on the wrapper around the disabled button opens the card.
        const trigger = button.closest('[data-slot="hover-card-trigger"]') as HTMLElement;
        fireEvent.pointerDown(trigger, { pointerType: "touch" });
        fireEvent.pointerUp(trigger, { pointerType: "touch" });

        expect(await screen.findByText(title)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: linkName })).toHaveAttribute("href", href);
      },
    );

    it.each([
      { role: "owner", hasLink: true },
      { role: "user", hasLink: false },
    ] as const)("links a blocked user recipient to the accounts screen only for an owner (role $role)", async ({ role, hasLink }) => {
      const user = userEvent.setup();
      mockAuthRole = role;
      try {
        mockJobHistory({
          ...needsSetupJobRecord,
          resendBlockedBy: "recipient",
          resendBlockedRecipient: { kind: "user", id: "user-9" },
        });
        render(<MessagesHistoryPage />);

        await openJobDetail(user);

        const trigger = screen.getByRole("button", { name: "재발송" }).closest('[data-slot="hover-card-trigger"]') as HTMLElement;
        fireEvent.pointerDown(trigger, { pointerType: "touch" });
        fireEvent.pointerUp(trigger, { pointerType: "touch" });

        expect(await screen.findByText("자동 문자가 꺼져 있어요")).toBeInTheDocument();
        const link = screen.queryByRole("link", { name: "계정 관리에서 켜기 →" });
        if (hasLink) {
          expect(link).toHaveAttribute("href", "/system-admin?section=accounts&item=user-9");
        } else {
          expect(link).toBeNull();
        }
      } finally {
        mockAuthRole = "user";
      }
    });

    it("keeps the 재발송 button enabled, without a hover card, when the safeguard would pass", async () => {
      const user = userEvent.setup();
      mockJobHistory({ ...needsSetupJobRecord, resendBlockedBy: null });
      render(<MessagesHistoryPage />);

      await openJobDetail(user);

      const button = screen.getByRole("button", { name: "재발송" });
      expect(button).toBeEnabled();
      expect(button.closest('[data-slot="hover-card-trigger"]')).toBeNull();
    });

    it("shows no 재발송 button to a plain branch user", async () => {
      const user = userEvent.setup();
      mockAuthBranchRole = "user";
      try {
        mockJobHistory();
        render(<MessagesHistoryPage />);

        await openJobDetail(user);

        expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
      } finally {
        mockAuthBranchRole = "manager";
      }
    });

    it.each([
      ["a needs_setup row that is not a trigger job", { provider: "aligo_sms" }],
      ["a trigger-job row without a job id", { triggerJobId: null }],
      ["a trigger-job row with a blank job id", { triggerJobId: "  " }],
      ["a trigger-job row that is not needs_setup", { status: "sent", errorMessage: null }],
    ])("offers no 재발송 button for %s", async (_label, overrides) => {
      const user = userEvent.setup();
      mockJobHistory({ ...needsSetupJobRecord, ...overrides });
      render(<MessagesHistoryPage />);

      await openJobDetail(user);

      expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
    });

    it("sends one request with the bare job uuid after one confirm, then closes the detail on sent", async () => {
      const user = userEvent.setup();
      const mutateAsync = jest.fn().mockResolvedValue({ id: JOB_UUID, status: "sent", reason: null });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync).toHaveBeenCalledWith(JOB_UUID);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: MESSAGE_JOB_RESEND_COPY.success,
        variant: "success",
      }));
      await waitFor(() => expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: "메시지를 다시 보낼까요?" })).not.toBeInTheDocument();
    });

    it("keeps the detail open and shows the returned reason while it still needs setup", async () => {
      const user = userEvent.setup();
      const newReason = "템플릿 값이 비어 있습니다.";
      const mutateAsync = jest.fn().mockResolvedValue({ id: JOB_UUID, status: "needs_setup", reason: newReason });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: MESSAGE_JOB_RESEND_COPY.stillNeedsSetup,
      })));
      expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
      expect(screen.getByText(newReason)).toBeInTheDocument();
      expect(screen.queryByText(SETUP_REASON)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "재발송" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "메시지를 다시 보낼까요?" })).not.toBeInTheDocument();
    });

    it("shows the not-sent copy followed by the returned reason on canceled, and closes the detail", async () => {
      const user = userEvent.setup();
      const mutateAsync = jest.fn().mockResolvedValue({
        id: JOB_UUID,
        status: "canceled",
        reason: "대상 고객 상태가 아니어서 보내지 않았습니다.",
      });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: `${MESSAGE_JOB_RESEND_COPY.notSent} 대상 고객 상태가 아니어서 보내지 않았습니다.`,
      })));
      await waitFor(() => expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument());
    });

    it("shows only the not-sent copy on canceled without a reason", async () => {
      const user = userEvent.setup();
      const mutateAsync = jest.fn().mockResolvedValue({ id: JOB_UUID, status: "canceled", reason: null });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: MESSAGE_JOB_RESEND_COPY.notSent,
      })));
    });

    it.each(["failed", "processing", "dispatching"])(
      "shows the generic failure copy for a %s outcome and closes the detail",
      async (status) => {
        const user = userEvent.setup();
        const mutateAsync = jest.fn().mockResolvedValue({ id: JOB_UUID, status, reason: null });
        mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
        mockJobHistory();
        render(<MessagesHistoryPage />);

        await openJobDetail(user);
        await confirmResend(user);

        await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
          description: MESSAGE_JOB_RESEND_COPY.failure,
          variant: "destructive",
        })));
        await waitFor(() => expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument());
      },
    );

    it("shows the conflict copy for a 409 problem rejection and closes the detail", async () => {
      const user = userEvent.setup();
      const problem = createProblemDetails({ code: "REQUEST_CONFLICT", requestId: "req-resend-1" });
      expect(problem.status).toBe(409);
      const mutateAsync = jest.fn().mockRejectedValue({ response: { status: 409, data: problem } });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: MESSAGE_JOB_RESEND_COPY.conflict,
        variant: "destructive",
      })));
      await waitFor(() => expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument());
    });

    it("shows the failure copy for a rejection with no problem body and closes the detail", async () => {
      const user = userEvent.setup();
      const mutateAsync = jest.fn().mockRejectedValue(new Error("network down"));
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await confirmResend(user);

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: MESSAGE_JOB_RESEND_COPY.failure,
        variant: "destructive",
      })));
      await waitFor(() => expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument());
    });

    it("never sends the job resend request when the confirm dialog is dismissed", async () => {
      const user = userEvent.setup();
      const mutateAsync = jest.fn();
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
      mockJobHistory();
      render(<MessagesHistoryPage />);

      await openJobDetail(user);
      await user.click(screen.getByRole("button", { name: "재발송" }));
      await user.keyboard("{Escape}");

      expect(mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
    });

    it("labels the button with the resend pending copy while the request is in flight", async () => {
      const user = userEvent.setup();
      mockJobHistory();
      const view = render(<MessagesHistoryPage />);
      await openJobDetail(user);
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: true });
      view.rerender(<MessagesHistoryPage />);

      const button = screen.getByRole("button", { name: MESSAGE_JOB_RESEND_COPY.pending });
      expect(button).toBeDisabled();
    });

    it("keeps the failed-log retry on the history retry mutation with its old labels", async () => {
      const user = userEvent.setup();
      const failedRecord = { ...sentRecord, id: 91, status: "failed" as const, errorMessage: "등록되지 않은 발신번호입니다." };
      const retryMutateAsync = jest.fn().mockResolvedValue({ ...failedRecord, status: "pending" });
      const resendMutateAsync = jest.fn();
      mockUseRetryMessageHistory.mockReturnValue({ mutateAsync: retryMutateAsync, isPending: false });
      mockUseResendMessageTriggerJob.mockReturnValue({ mutateAsync: resendMutateAsync, isPending: false });
      mockJobHistory(failedRecord);
      render(<MessagesHistoryPage />);

      await user.click(screen.getByRole("button", { name: /김문자/ }));
      expect(screen.getByText("실패 사유")).toBeInTheDocument();
      expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument();
      await confirmResend(user);

      await waitFor(() => expect(retryMutateAsync).toHaveBeenCalledWith(91));
      expect(resendMutateAsync).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: "재발송 요청을 접수했어요" }));
    });
  });
});
