import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { ClientDetailContent } from "../client-detail";
import type { Client } from "@/lib/client/types";
import type { EformsignDocument } from "@/lib/eformsign/types";

jest.mock("@/hooks/useServiceRecords", () => ({
  applyServiceScheduleChange: jest.fn(),
  fetchClientServiceRecords: jest.fn(),
  previewServiceScheduleChange: jest.fn(),
  resetServiceRecordLink: jest.fn(),
  useClientServiceRecords: () => ({
    data: undefined,
    isError: false,
    isLoading: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  approveScheduleChange: jest.fn(),
  rejectScheduleChange: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  DetailTabPills: () => null,
  InfoCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  InfoRow: ({ label, value }: { label?: string; value: ReactNode }) => (
    <div>
      {label ? <span>{label}</span> : null}
      <span>{value}</span>
    </div>
  ),
  MobileDetailActions: () => null,
  MobileDetailHeader: () => null,
  MobileDetailPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  MobileDetailTabPanel: ({
    activeTab,
    children,
    tabId,
  }: {
    activeTab: string;
    children: ReactNode;
    tabId: string;
  }) => (activeTab === tabId ? <div>{children}</div> : null),
}));

jest.mock("../client-message-history-detail", () => ({
  ClientMessageHistoryDetail: () => null,
}));

jest.mock("../client-service-records", () => ({
  ClientServiceRecords: () => null,
}));

jest.mock("../ServiceRecordLinkResetResultModal", () => ({
  ServiceRecordLinkResetResultModal: () => null,
}));

jest.mock("../ServiceScheduleChangeModal", () => ({
  ServiceScheduleChangeModal: () => null,
}));

const client: Client = {
  id: 1,
  name: "고객",
  birthday: null,
  dueDate: null,
  address: null,
  phone: null,
  primaryEmployee: {
    id: 10,
    name: "현재 제공인력",
    phone: "01011112222",
  },
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

function renderDetail(
  contractDocument: EformsignDocument | null = null,
  detailClient: Client = client,
) {
  return render(
    <ClientDetailContent
      client={detailClient}
      contractDocument={contractDocument}
      activeTab="basic"
      onTabChange={jest.fn()}
      onMessage={jest.fn()}
      onIssueContract={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onClientUpdated={jest.fn()}
    />,
  );
}

describe("ClientDetailContent", () => {
  it("should show the currently assigned employee phone when the contract has no phone", () => {
    renderDetail();

    expect(screen.getByText("제공인력 1 연락처")).toBeInTheDocument();
    expect(screen.getByText("01011112222")).toBeInTheDocument();
  });

  it("should prefer the currently assigned employee phone over a stale contract phone", () => {
    const contractDocument = {
      fields: [
        {
          id: "caretaker1Contact",
          value: "01099998888",
        },
      ],
    } as EformsignDocument;

    renderDetail(contractDocument);

    expect(screen.getByText("01011112222")).toBeInTheDocument();
    expect(screen.queryByText("01099998888")).not.toBeInTheDocument();
  });

  it("should show employee phone rows with a dash when phone numbers are missing", () => {
    renderDetail(null, {
      ...client,
      primaryEmployee: {
        ...client.primaryEmployee!,
        phone: null,
      },
    });

    expect(screen.getByText("제공인력 1 연락처").closest("div")).toHaveTextContent("-");
    expect(screen.getByText("제공인력 2 연락처").closest("div")).toHaveTextContent("-");
  });
});
