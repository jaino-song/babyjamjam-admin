import { fireEvent, render, screen } from "@testing-library/react";
import type { Client } from "@/lib/client/types";
import { ClientDetailContent } from "../client-detail";

const mockMutateAsync = jest.fn();
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({ useRetryMessageHistory: () => ({ mutateAsync: jest.fn(), isPending: false }), useResendMessageTriggerJob: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
let mockIsPending = false;

jest.mock("@/features/clients", () => ({
  useConfirmBooking: () => ({ mutateAsync: mockMutateAsync, isPending: mockIsPending }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

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
}));

jest.mock("@/hooks/useClients", () => ({ fetchClient: jest.fn() }));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }),
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
  expect(idle).toHaveTextContent(idleLabel);
  expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(screen.getByText(label)).toHaveClass("sr-only");
  return button;
}

beforeEach(() => { mockIsPending = false; });

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
