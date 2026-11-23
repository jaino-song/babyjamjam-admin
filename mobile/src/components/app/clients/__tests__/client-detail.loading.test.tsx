import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";
import type { Employee } from "@/hooks/useEmployees";
import type { Client } from "@/lib/client/types";
import { ClientFormDialog } from "../ClientFormDialog";
import { EmployeeFormDialog } from "../../employees/EmployeeFormDialog";
import { EmployeeDetailContent } from "../../employees/EmployeeDetailContent";
import { ClientDetailContent } from "../client-detail";

const mockMutateAsync = jest.fn();
const mockSendLink = jest.fn();
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockCreateEmployee = jest.fn();
const mockUpdateEmployee = jest.fn();
const mockEmptyData: never[] = [];
let mockReceiptDetail: Client | undefined;
let mockClientPending = false;
let mockEmployeePending = false;
let mockPriceLoading = false;
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({ useRetryMessageHistory: () => ({ mutateAsync: jest.fn(), isPending: false }), useResendMessageTriggerJob: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
let mockIsPending = false;

jest.mock("@/features/clients", () => ({
  useConfirmBooking: () => ({ mutateAsync: mockMutateAsync, isPending: mockIsPending }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: mockEmptyData, isLoading: false }),
  useCreateEmployee: () => ({ mutateAsync: mockCreateEmployee, isPending: mockEmployeePending }),
  useUpdateEmployee: () => ({ mutateAsync: mockUpdateEmployee, isPending: mockEmployeePending }),
  useEmployeeActiveClients: () => ({ data: mockEmptyData, isLoading: false }),
  useEmployeeWorkHistory: () => ({ history: mockEmptyData, isLoading: false, isError: false }),
  useToggleEmployeeOpenStatus: () => ({ mutate: jest.fn(), isPending: false }),
  employeeQueryKeys: { all: ["employees"] },
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn() }),
  useQuery: () => ({ data: mockReceiptDetail }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useVoucherData", () => ({
  useVoucherPriceInfos: () => ({ data: mockEmptyData, isLoading: mockPriceLoading }),
  useOutOfPocketPriceInfos: () => ({ data: mockEmptyData, isLoading: mockPriceLoading, isError: false }),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({ data: { exists: false } }) } }));

jest.mock("next/navigation", () => ({
  usePathname: () => "/clients",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "user", branchRole: "manager" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

jest.mock("@/hooks/useServiceRecords", () => ({
  fetchClientServiceRecords: jest.fn(),
  resetServiceRecordLink: jest.fn(),
  useClientServiceRecords: () => ({ data: undefined, isError: false, isLoading: false }),
  useSendServiceRecordLink: () => ({ mutateAsync: mockSendLink, isPending: false }),
  useKeepPeriodMismatch: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useFitPeriodMismatch: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("@/hooks/useClients", () => ({
  fetchClient: jest.fn(),
  clientQueryKeys: { detail: (id: number) => ["clients", "detail", id] },
  useCreateClient: () => ({ mutateAsync: mockCreateClient, isPending: mockClientPending }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClient, isPending: mockClientPending }),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("../client-service-records", () => ({ ClientServiceRecords: () => null }));
jest.mock("../ServiceRecordLinkResetResultModal", () => ({ ServiceRecordLinkResetResultModal: () => null }));
jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn(), getLinkConfirmations: jest.fn().mockResolvedValue([]) },
}));


const baseClient: Client = {
  id: 7,
  name: "예약 고객",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: null,
  phone: "01012345678",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: "2026-11-02",
  endDate: "2026-11-20",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  bookingConfirmedAt: null,
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};


function renderDetail(props: Partial<Parameters<typeof ClientDetailContent>[0]> = {}) {
  return render(<ClientDetailContent data-component="mobile_clients_detail-sheet_content" client={baseClient} contractDocument={null} activeTab="basic" onTabChange={jest.fn()} onMessage={jest.fn()} onIssueContract={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()} {...props} />);
}

function expectBusy(label: string, idleLabel: string) {
  const button = screen.getByRole("button", { name: label });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  if (idleLabel) expect(idle).toHaveTextContent(idleLabel);
  else expect(idle?.textContent).toBe("");
  expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(button.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText(label)).toHaveClass("sr-only");
  return button;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsPending = false;
  mockReceiptDetail = undefined;
  mockClientPending = false;
  mockEmployeePending = false;
  mockPriceLoading = false;
});

it("uses the action busy label during booking confirmation", () => {
  mockIsPending = true;
  renderDetail();
  fireEvent.click(expectBusy("확정 중", "예약 확정"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uses the action busy label and blocks repeated contract issuance", () => {
  const onIssueContract = jest.fn();
  renderDetail({ isIssuingContract: true, onIssueContract });
  fireEvent.click(expectBusy("발급 중", "계약서 발급"));
  expect(onIssueContract).not.toHaveBeenCalled();
});

it("names the message history loading status without visible wait copy", () => {
  renderDetail({ activeTab: "message", isNotificationLogsLoading: true });
  const status = screen.getByRole("status", { name: "발송 내역을 불러오는 중" });
  expect(status).toHaveAttribute("data-component", "mobile_clients_detail-sheet_content_tab-panel_message_history-card_loading");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("발송 내역을 불러오는 중")).toHaveClass("sr-only");
});

it("uses the shared icon size for client options", () => {
  renderDetail();
  const button = screen.getByRole("button", { name: "고객 옵션" });
  expect(button).toHaveAttribute("data-size", "icon");
  expect(button).toHaveClass("h-8", "w-8", "relative", "after:-inset-1.5");
});

it.each(["취소", "Escape"])("opens an editable receipt date and dismisses with %s without a request", async (dismiss) => {
  const originalFetch = globalThis.fetch;
  const fetch = jest.fn();
  globalThis.fetch = fetch;
  document.cookie = "selected_branch_id=qa-branch; path=/";
  mockReceiptDetail = { ...baseClient, copaymentReceivedDate: "2026-11-20" };

  try {
    renderDetail();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "고객 옵션" }));
    await user.click(screen.getByRole("menuitem", { name: "본인부담금 영수증 발송" }));
    const dialog = screen.getByRole("dialog", { name: "본인부담금 영수증 발송" });
    const date = within(dialog).getByRole("textbox", { name: "본인부담금 납부일" });
    expect(date).toHaveValue("2026-11-20");
    fireEvent.change(date, { target: { value: "2026-11-21" } });
    expect(date).toHaveValue("2026-11-21");
    expect(within(dialog).getByRole("button", { name: "전송" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();

    if (dismiss === "Escape") await user.keyboard("{Escape}");
    else await user.click(within(dialog).getByRole("button", { name: dismiss }));
    expect(dialog).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    document.cookie = "selected_branch_id=; max-age=0; path=/";
  }
});

it.each([false, true])("uses a named submit spinner in the client form (edit: %s)", async (editing) => {
  const client = editing ? baseClient : undefined;
  const view = render(<ClientFormDialog open onClose={jest.fn()} client={client} />);
  await act(async () => {});
  const idleLabel = editing ? "저장" : "생성";
  expect(screen.getByRole("button", { name: idleLabel })).toBeEnabled();
  mockClientPending = true;
  view.rerender(<ClientFormDialog open onClose={jest.fn()} client={client} />);
  fireEvent.click(expectBusy(editing ? "저장 중" : "등록 중", idleLabel));
  expect(mockCreateClient).not.toHaveBeenCalled();
  expect(mockUpdateClient).not.toHaveBeenCalled();
});

it.each([false, true])("names the inline client price spinner (voucher: %s)", async (voucherClient) => {
  mockPriceLoading = true;
  await act(async () => {
    render(<ClientFormDialog open onClose={jest.fn()} client={{ ...baseClient, voucherClient, type: "가형" }} />);
  });
  const status = screen.getByRole("status", { name: "서비스 기간 요금 정보를 불러오는 중" });
  expect(status.tagName).toBe("SPAN");
  expect(status).toHaveAttribute("data-source-component", "LoadingState");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(within(status).getByText("서비스 기간 요금 정보를 불러오는 중")).toHaveClass("sr-only");
  expect(screen.getByRole("combobox", { name: "서비스 기간" })).toBeDisabled();
});

const employee: Employee = {
  id: 187, name: "QA-제공인력", phone: "01012345678", workArea: [], grade: "스탠다드",
  openToNextWork: true, registeredDate: null, status: "available",
};

it.each([false, true])("passes the employee form busy label through the real slide-up action (edit: %s)", async (editing) => {
  mockEmployeePending = true;
  await act(async () => {
    render(<EmployeeFormDialog open onClose={jest.fn()} employee={editing ? employee : undefined} />);
  });
  fireEvent.click(expectBusy(editing ? "저장 중" : "등록 중", editing ? "저장" : "등록"));
  expect(mockCreateEmployee).not.toHaveBeenCalled();
  expect(mockUpdateEmployee).not.toHaveBeenCalled();
});

it("uses the 32px icon button with a 44px touch area for employee options", () => {
  render(<EmployeeDetailContent employee={employee} activeTab="basic" onTabChange={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} canManage />);
  const button = screen.getByRole("button", { name: "제공인력 옵션" });
  expect(button).toHaveAttribute("data-size", "icon");
  expect(button).toHaveClass("h-8", "w-8", "relative", "after:-inset-1.5");
  expect(button).not.toHaveClass("h-[44px]", "w-[44px]");
});

// Keep the detail-content tests isolated above, but exercise the real records
// component here so LinkCard and refresh regressions cannot hide behind its mock.
const { ClientServiceRecords } = jest.requireActual<typeof import("../client-service-records")>("../client-service-records");
const overview: ServiceRecordOverview = {
  record: null,
  assignments: [{
    scheduleId: 1, startDate: "2026-11-02", endDate: "2026-11-20", replaced: false,
    employee: { id: employee.id, name: employee.name, phone: employee.phone },
    link: { status: "none", scheduledFor: null, sentCount: 0, lastSentAt: null, token: null },
    header: null, totalSessions: 1, sessions: [], signatureDoc: null,
  }],
};

it("shows only a named spinner on LinkCard during send and restores the idle action afterwards", async () => {
  let finish!: (value: { status: string }) => void;
  mockSendLink.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<ClientServiceRecords data-component="mobile_clients_detail_service-records" client={baseClient} activeTab="serviceRecords" overview={overview} isLoading={false} isError={false} />);
  fireEvent.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));
  const button = expectBusy("발송 중", "제공기록지 링크 발송");
  expect(button).toHaveClass("relative");
  fireEvent.click(button);
  expect(mockSendLink).toHaveBeenCalledTimes(1);
  expect(mockSendLink).toHaveBeenCalledWith({ scheduleId: 1, clientId: baseClient.id });
  await act(async () => { finish({ status: "sent" }); });
  expect(screen.getByRole("button", { name: "제공기록지 링크 발송" })).toBeEnabled();
});

it("centers a named spinner on the refresh icon and blocks refresh while busy", () => {
  const onRefresh = jest.fn();
  render(<ClientServiceRecords data-component="mobile_clients_detail_service-records" client={baseClient} activeTab="serviceRecords" overview={overview} isLoading={false} isError={false} isRefreshing onRefresh={onRefresh} />);
  const button = expectBusy("제공기록 새로고침 중", "");
  expect(button.querySelector('[data-slot="button-idle"] svg')).not.toBeNull();
  expect(button).toHaveAttribute("data-size", "icon");
  expect(button).toHaveClass("h-8", "w-8", "relative", "after:-inset-1.5");
  fireEvent.click(button);
  expect(onRefresh).not.toHaveBeenCalled();
});
