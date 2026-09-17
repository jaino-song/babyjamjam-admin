import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import {
  ClientDetailContent,
  type ClientNotificationLogRecord,
  type DetailTabId,
} from "../client-detail";
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
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({
    isSending: false,
    sendReceipt: jest.fn(),
  }),
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  DetailTabPills: () => null,
  InfoCard: ({ children, title }: { children: ReactNode; title?: string }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
  InfoRow: ({ label, value }: { label?: string; value: ReactNode }) => (
    <div>
      {label ? <span>{label}</span> : null}
      <span>{value}</span>
    </div>
  ),
  MobileDetailActions: () => null,
  MobileDetailHeader: ({ menu }: { menu?: ReactNode }) => <header>{menu}</header>,
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
  birthDate: null,
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
  activeTab: DetailTabId = "basic",
) {
  return render(
    <ClientDetailContent
      data-component="mobile_clients_detail-sheet_stack_detail-page_content"
      client={detailClient}
      contractDocument={contractDocument}
      activeTab={activeTab}
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
  it.each([
    ["unsigned", false, "고객 (고객)"],
    ["signed while provider review is pending", true, "-"],
  ])("uses hasSigned to show the %s pending signer", (_state, hasSigned, pendingSigner) => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned,
      documentStatus: "requested" as const,
    };
    const contractDocument = {
      id: "document-1",
      current_status: {
        status_type: "070",
        step_type: "06",
        step_name: "제공기관 확인",
      },
    } as EformsignDocument;

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("서명 대기자").closest("div")).toHaveTextContent(pendingSigner);
  });

  it("keeps the completed contract badge for completed documents", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "completed" as const,
    };
    const contractDocument = {
      id: "document-1",
      current_status: {
        status_type: "003",
        step_type: "",
        step_name: "",
      },
    } as EformsignDocument;

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getAllByText("계약 완료").length).toBeGreaterThan(0);
    expect(screen.getByText("서명 대기자").closest("div")).toHaveTextContent("-");
  });

  it("should show the currently assigned employee phone when the contract has no phone", () => {
    renderDetail();

    expect(screen.getByText("주 담당 인력 연락처")).toBeInTheDocument();
    expect(screen.getByText("010-1111-2222")).toBeInTheDocument();
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

    expect(screen.getByText("010-1111-2222")).toBeInTheDocument();
    expect(screen.queryByText("01099998888")).not.toBeInTheDocument();
  });

  it("formats the customer phone like desktop", () => {
    renderDetail(null, {
      ...client,
      phone: "01027700718",
    });

    expect(screen.getByText("010-2770-0718")).toBeInTheDocument();
  });

  it("confirms the exact receipt-send copy from the customer overflow menu", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "고객 옵션" }));
    await user.click(screen.getByRole("menuitem", { name: /본인부담금 영수증 발송/ }));

    expect(screen.getByRole("dialog", { name: "본인부담금 영수증 전송" })).toBeInTheDocument();
    expect(screen.getByText("고객 산모님께 본인부담금 영수증 안내 메시지를 보낼까요?")).toBeInTheDocument();
  });

  it("should show employee phone rows with a dash when phone numbers are missing", () => {
    renderDetail(null, {
      ...client,
      primaryEmployee: {
        ...client.primaryEmployee!,
        phone: null,
      },
    });

    expect(screen.getByText("주 담당 인력 연락처").closest("div")).toHaveTextContent("-");
    expect(screen.getByText("보조 담당 인력 연락처").closest("div")).toHaveTextContent("-");
  });

  it("should match desktop labels and service duration rows", () => {
    renderDetail(null, { ...client, duration: 10 });

    expect(screen.getByText("담당 관리사")).toBeInTheDocument();
    expect(screen.getByText("주 담당 인력")).toBeInTheDocument();
    expect(screen.getByText("보조 담당 인력")).toBeInTheDocument();
    expect(screen.getByText("서비스 기간").closest("div")).toHaveTextContent("10일");
    expect(screen.queryByText("계약 서명일")).not.toBeInTheDocument();
    expect(screen.queryByText("본인부담금 수령일")).not.toBeInTheDocument();
  });

  it("shows an original failure and its successful retry as separate history items", () => {
    const baseLog: ClientNotificationLogRecord = {
      id: 49,
      provider: "aligo_sms",
      templateKey: "service_record_link_sms",
      receiver: "01012345678",
      recipientPhone: "01012345678",
      recipientName: "관리사",
      clientId: client.id,
      status: "failed",
      messageBody: "제공기록지 작성 링크",
      errorMessage: "등록/인증되지 않은 발신번호입니다.",
      createdAt: "2026-07-22T17:13:11.811Z",
      ruleName: "제공기록지 작성 링크",
      variables: {},
    };

    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[
          {
            ...baseLog,
            id: 50,
            status: "sent",
            errorMessage: null,
            createdAt: "2026-07-22T17:30:00.850Z",
            variables: { retryOfLogId: "49", retryAttempt: "2" },
          },
          baseLog,
        ]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    expect(screen.getAllByText("메시지 · 제공기록지 작성 링크")).toHaveLength(2);
    expect(screen.getByText("발송 실패")).toBeInTheDocument();
    expect(screen.getByText("발송 성공")).toBeInTheDocument();
  });
});
