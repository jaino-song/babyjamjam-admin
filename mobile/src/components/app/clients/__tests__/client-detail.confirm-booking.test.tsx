import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { toast } from "@/hooks/use-toast";
import type { Client } from "@/lib/client/types";

import { ClientDetailContent } from "../client-detail";

const mockMutateAsync = jest.fn();
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
  applyServiceScheduleChange: jest.fn(),
  fetchClientServiceRecords: jest.fn(),
  previewServiceScheduleChange: jest.fn(),
  resetServiceRecordLink: jest.fn(),
  useClientServiceRecords: () => ({ data: undefined, isError: false, isLoading: false }),
}));

jest.mock("@/hooks/useClients", () => ({
  approveScheduleChange: jest.fn(),
  rejectScheduleChange: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }),
}));

jest.mock("../client-service-records", () => ({ ClientServiceRecords: () => null }));
jest.mock("../ServiceRecordLinkResetResultModal", () => ({ ServiceRecordLinkResetResultModal: () => null }));
jest.mock("../ServiceScheduleChangeModal", () => ({ ServiceScheduleChangeModal: () => null }));
jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn(), getLinkConfirmations: jest.fn().mockResolvedValue([]) },
}));

const mockToast = toast as jest.Mock;

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

const CONFIRM_BUTTON = { name: "예약 확정" };
const HELPER = "서비스 시작일과 종료일을 먼저 입력해 주세요.";
const FAILURE =
  "예약을 확정하지 못했습니다. 시작일·종료일과 고객 상태를 확인한 뒤 다시 시도해 주세요.";

// The open detail renders from a locally held snapshot (client-detail-controller), so the screen only
// changes when `onClientUpdated` hands it a new client. This harness plays that part.
function Harness({ initial }: { initial: Client }) {
  const [client, setClient] = useState(initial);
  return (
    <ClientDetailContent
      data-component="mobile_clients_detail-sheet_stack_detail-page_content"
      client={client}
      contractDocument={null}
      activeTab="basic"
      onTabChange={jest.fn()}
      onMessage={jest.fn()}
      onIssueContract={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onClientUpdated={setClient}
    />
  );
}

function renderDetail(overrides: Partial<Client> = {}) {
  return render(<Harness initial={{ ...baseClient, ...overrides }} />);
}

describe("ClientDetailContent 예약 확정 (rule 고객-04)", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockToast.mockReset();
    mockIsPending = false;
  });

  describe("when the button is shown", () => {
    it("is shown and enabled for an unconfirmed client with both dates, without the helper", () => {
      renderDetail();

      expect(screen.getByRole("button", CONFIRM_BUTTON)).toBeEnabled();
      expect(screen.queryByText(HELPER)).not.toBeInTheDocument();
    });

    it("is hidden once the booking is confirmed", () => {
      renderDetail({ bookingConfirmedAt: "2026-10-01T00:00:00.000Z", serviceStatus: "waiting" });

      expect(screen.queryByRole("button", CONFIRM_BUTTON)).not.toBeInTheDocument();
    });

    it.each(["terminated", "replacement_requested"] as const)("is hidden for a %s client", (serviceStatus) => {
      renderDetail({ serviceStatus });

      expect(screen.queryByRole("button", CONFIRM_BUTTON)).not.toBeInTheDocument();
      expect(screen.queryByText(HELPER)).not.toBeInTheDocument();
    });

    it.each([{ startDate: null }, { endDate: null }])(
      "is disabled with the visible helper text when a date is missing (%o)",
      (missing) => {
        renderDetail(missing);

        expect(screen.getByRole("button", CONFIRM_BUTTON)).toBeDisabled();
        expect(screen.getByText(HELPER)).toBeVisible();
      },
    );

    it("keeps 메시지 and 계약서 발급 next to it", () => {
      renderDetail();

      expect(screen.getByRole("button", { name: "메시지" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "계약서 발급" })).toBeInTheDocument();
    });
  });

  describe("confirming", () => {
    it("asks first, and cancelling calls nothing", async () => {
      const user = userEvent.setup();
      renderDetail();

      await user.click(screen.getByRole("button", CONFIRM_BUTTON));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("예약을 확정할까요?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "확정하면 서비스 일정에 따라 상태가 대기·진행·완료로 바뀌고, 제공기록지와 안내 문자가 일정대로 준비됩니다. 확정은 되돌릴 수 없습니다.",
        ),
      ).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "취소" }));

      expect(mockMutateAsync).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("confirms once even when the modal button is tapped twice, then drops the button and reports success", async () => {
      let resolveConfirm: (value: unknown) => void = () => {};
      mockMutateAsync.mockReturnValue(new Promise((resolve) => { resolveConfirm = resolve; }));
      const user = userEvent.setup();
      renderDetail();

      await user.click(screen.getByRole("button", CONFIRM_BUTTON));
      const dialog = await screen.findByRole("dialog");
      const approve = within(dialog).getByRole("button", { name: "예약 확정" });
      await user.dblClick(approve);

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith(7);

      await act(async () => {
        resolveConfirm({ id: 7, serviceStatus: "waiting", bookingConfirmedAt: "2026-10-13T01:00:00.000Z" });
      });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(mockToast).toHaveBeenCalledWith({ variant: "success", description: "예약을 확정했습니다." });
      // The open detail stops offering the button without waiting for a refetch.
      expect(screen.queryByRole("button", CONFIRM_BUTTON)).not.toBeInTheDocument();
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    it("shows the authored sentence, never the server's, and keeps the button when the server refuses", async () => {
      mockMutateAsync.mockRejectedValue({
        response: { status: 400, data: { message: "RAW SERVER MESSAGE", code: "VALIDATION_FAILED" } },
      });
      const user = userEvent.setup();
      renderDetail();

      await user.click(screen.getByRole("button", CONFIRM_BUTTON));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "예약 확정" }));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({ description: FAILURE, variant: "destructive" }),
      );
      expect(JSON.stringify(mockToast.mock.calls)).not.toContain("RAW SERVER MESSAGE");
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
      expect(screen.getByRole("button", CONFIRM_BUTTON)).toBeEnabled();
    });

    it("can be retried after a refusal", async () => {
      mockMutateAsync
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ id: 7, serviceStatus: "active", bookingConfirmedAt: "2026-10-13T01:00:00.000Z" });
      const user = userEvent.setup();
      renderDetail();

      await user.click(screen.getByRole("button", CONFIRM_BUTTON));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "예약 확정" }));
      await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ description: FAILURE, variant: "destructive" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", CONFIRM_BUTTON));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "예약 확정" }));

      await waitFor(() => expect(screen.queryByRole("button", CONFIRM_BUTTON)).not.toBeInTheDocument());
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    });
  });
});
