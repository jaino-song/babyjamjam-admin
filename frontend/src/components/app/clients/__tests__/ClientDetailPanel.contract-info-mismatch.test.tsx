import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Client, ClientBadge } from "@/features/clients/types";
import type { PanelTitleNotice } from "@/components/app/v3/PanelTitleGroup";
import { ClientDetailPanel } from "../ClientDetailPanel";

jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useConfirmBooking: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useRetryMessageHistory: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useResendMessageTriggerJob: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
  DetailPanel: ({
    avatar,
    badges,
    headerNotice,
    children,
  }: {
    avatar?: ReactNode;
    badges?: ReactNode;
    headerNotice?: PanelTitleNotice | null;
    children: ReactNode;
  }) => (
    <main data-testid="detail-panel">
      <div data-testid="detail-avatar">{avatar}</div>
      <div data-testid="detail-badges">{badges}</div>
      {headerNotice ? (
        <p role="status" data-tone={headerNotice.tone}>{headerNotice.icon}{headerNotice.content}</p>
      ) : null}
      {children}
    </main>
  ),
  DetailTabPanels: () => null,
  DetailTabs: () => null,
  StatusBadge: ({ label }: { label?: string }) => <span data-testid="status-badge">{label}</span>,
}));

const serviceBadge: ClientBadge = { key: "service_status", status: "active", label: "진행중", tone: "primary", priority: 20 };
const mismatchBadge: ClientBadge = { key: "contract_info_mismatch", status: "review", label: "정보 불일치", tone: "warning", priority: 5 };

const client: Client = {
  id: 76, name: "QA-정보불일치", birthday: null, dueDate: null, birthDate: null, address: null, phone: null,
  primaryEmployee: null, secondaryEmployee: null, type: null, duration: null, fullPrice: null,
  grant: null, actualPrice: null, startDate: "2026-12-01", endDate: "2026-12-15", careCenter: false,
  voucherClient: false, breastPump: false, serviceStatus: "active", bookingConfirmedAt: "2026-11-01T00:00:00.000Z",
  eDocId: null, hasSigned: true, documentStatus: "completed",
};

function renderPanel(badges: ClientBadge[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <ClientDetailPanel client={{ ...client, badges }} trailing={null} />
  </QueryClientProvider>);
}

describe("ClientDetailPanel contract info mismatch", () => {
  it("shows the 정보 불일치 pill first and the notice under the subtitle", () => {
    renderPanel([serviceBadge, mismatchBadge]);

    const badgeRow = screen.getByTestId("detail-badges");
    const pill = within(badgeRow).getByText("정보 불일치");
    expect(pill).toHaveAttribute("data-slot", "status-badge");
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(badgeRow.firstElementChild).toBe(pill);
    expect(within(badgeRow).getByTestId("status-badge")).toHaveTextContent("진행중");

    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-tone", "warning");
    expect(notice).toHaveTextContent("계약서가 완료된 상태라 변경된 정보를 반영하지 못했어요. 계약서는 따로 확인해 주세요.");
  });

  it("keeps the avatar on the service-status tone", () => {
    renderPanel([serviceBadge, mismatchBadge]);
    expect(screen.getByTestId("detail-avatar").firstElementChild).toHaveClass("bg-status-info");
  });

  it("shows no notice when the info matches the contract", () => {
    renderPanel([serviceBadge]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("정보 불일치")).not.toBeInTheDocument();
  });
});
