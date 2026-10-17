import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Client } from "@/features/clients/types";
import { ClientDetailPanel } from "../ClientDetailPanel";

const mockConfirm = jest.fn();
const mockToast = jest.fn();
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useConfirmBooking: () => ({ mutateAsync: mockConfirm, isPending: false }),
  useApproveScheduleChange: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRejectScheduleChange: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useClientMessageHistory: () => ({ items: [], refetch: jest.fn() }),
  useClientUpcomingMessageTriggerJobs: () => ({ items: [], refetch: jest.fn() }),
}));
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useClientServiceRecords: () => ({}),
  useClientServiceRecordRevisionHistory: () => ({}),
  useRetryServiceRecordDocument: () => ({}),
}));
jest.mock("@/services/api", () => ({ eformsignApi: {
  getDocumentsByClientId: jest.fn().mockResolvedValue([]),
  getLinkConfirmations: jest.fn().mockResolvedValue([]),
} }));
jest.mock("@/components/app/clients/ClientServiceRecordsTab", () => ({ ClientServiceRecordsTab: () => null }));
jest.mock("@/components/app/v3", () => ({
  DetailPanel: ({ trailing, children }: { trailing: ReactNode; children: ReactNode }) => <main>{trailing}{children}</main>,
  DetailTabPanels: () => null,
  DetailTabs: () => null,
}));

const client: Client = {
  id: 75, name: "예약고객", birthday: null, dueDate: null, birthDate: null, address: null, phone: null,
  primaryEmployee: null, secondaryEmployee: null, type: null, duration: null, fullPrice: null,
  grant: null, actualPrice: null, startDate: "2026-12-01", endDate: "2026-12-15", careCenter: false,
  voucherClient: false, breastPump: false, serviceStatus: "pre_booking", bookingConfirmedAt: null,
  eDocId: null, hasSigned: false, documentStatus: null,
};
function renderPanel(overrides: Partial<Client> = {}, onBookingConfirmed = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <ClientDetailPanel client={{ ...client, ...overrides }} trailing={<span>기존 메뉴</span>} onBookingConfirmed={onBookingConfirmed} />
  </QueryClientProvider>);
}

describe("ClientDetailPanel confirm booking", () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it.each([
    { bookingConfirmedAt: "2026-10-13T00:00:00.000Z" },
    { serviceStatus: "terminated" as const },
    { serviceStatus: "replacement_requested" as const },
  ])("hides confirmation for %j", (overrides) => {
    renderPanel(overrides);
    expect(screen.queryByRole("button", { name: "예약 확정" })).not.toBeInTheDocument();
    expect(screen.getByText("기존 메뉴")).toBeInTheDocument();
  });
  it("shows enabled confirmation for an unconfirmed dated client", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "예약 확정" })).toBeEnabled();
  });
  it.each(["startDate", "endDate"] as const)("disables confirmation with an accessible explanation for missing %s", (date) => {
    renderPanel({ [date]: null });
    const button = screen.getByRole("button", { name: "예약 확정" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "서비스 시작일과 종료일을 먼저 입력해 주세요.");
    expect(button).toHaveAccessibleDescription("서비스 시작일과 종료일을 먼저 입력해 주세요.");
  });
  it("confirms once, stays busy, merges only booking fields and hides the button on success", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockConfirm.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onBookingConfirmed = jest.fn();
    renderPanel({}, onBookingConfirmed);
    fireEvent.click(screen.getByRole("button", { name: "예약 확정" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("예약을 확정할까요?")).toBeInTheDocument();
    expect(within(dialog).getByText("확정하면 서비스 일정에 따라 상태가 대기·진행·완료로 바뀌고, 제공기록지와 안내 문자가 일정대로 준비됩니다. 확정은 되돌릴 수 없습니다.")).toBeVisible();
    const approval = within(dialog).getByRole("button", { name: "예약 확정" });
    fireEvent.click(approval);
    fireEvent.click(approval);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(75);
    expect(approval).toBeDisabled();
    expect(approval).toHaveAttribute("aria-busy", "true");
    await act(async () => resolve({ id: 75, bookingConfirmedAt: "2026-10-13T00:00:00.000Z", serviceStatus: "waiting", name: "raw entity", primaryEmployee: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "예약 확정" })).not.toBeInTheDocument();
    expect(onBookingConfirmed).toHaveBeenCalledWith({ id: 75, bookingConfirmedAt: "2026-10-13T00:00:00.000Z", serviceStatus: "waiting" });
    expect(mockToast).toHaveBeenCalledWith({ variant: "success", description: "예약을 확정했습니다." });
  });
  it("closes on failure and uses authored copy instead of the server message", async () => {
    mockConfirm.mockRejectedValue(new Error("private server message"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "예약 확정" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "예약 확정" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockToast).toHaveBeenCalledWith({ variant: "destructive", description: "예약을 확정하지 못했습니다. 시작일·종료일과 고객 상태를 확인한 뒤 다시 시도해 주세요." });
    expect(screen.getByRole("button", { name: "예약 확정" })).toBeEnabled();
  });
  it("cancels without confirming", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "예약 확정" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
