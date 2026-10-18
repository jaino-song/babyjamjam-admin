import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { formatMessageDateTimeCompact, MESSAGE_JOB_RESEND_COPY } from "@babyjamjam/shared";
import { AxiosError, AxiosHeaders } from "axios";
import { CONTRACT_VOID_COPY } from "@babyjamjam/shared/constants/eformsign-doc-status";
import { eformsignApi } from "@/services/api";
import { toast } from "@/hooks/use-toast";

import {
  ClientDetailContent,
  type ClientNotificationLogRecord,
  type DetailTabId,
} from "../client-detail";
import type { Client } from "@/lib/client/types";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { useIssueContract } from "@/hooks/useIssueContract";
import { useFormStore } from "@/stores/form-store";

const mockRetryHistory = jest.fn();
const mockResendJob = jest.fn();
const mockUseResendJob = jest.fn((_clientId?: unknown) => ({ mutateAsync: mockResendJob, isPending: false }));
const mockUseRetryHistory = jest.fn((_clientId?: unknown) => ({ mutateAsync: mockRetryHistory, isPending: false }));
let mockMessageBranchRole = "manager";
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useRetryMessageHistory: (...args: unknown[]) => mockUseRetryHistory(...args),
  useResendMessageTriggerJob: (...args: unknown[]) => mockUseResendJob(...args),
}));

describe("client message lookup detail labels", () => {
  it.each(["checking", "exhausted"])("renders %s in detail without changing the list label", async historyLookup => {
    const row: ClientNotificationLogRecord = {
      id: 901, provider: "aligo_sms", templateKey: "service_record_link_sms", status: "failed",
      receiver: "01012345678", messageBody: "내용", variables: { historyLookup },
      recipientName: null, clientId: null, errorMessage: null, ruleName: null,
      createdAt: "2026-10-12T00:00:00Z",
    };
    render(<ClientDetailContent data-component="mobile_clients_detail-sheet_stack_detail-page_content"
      client={client} contractDocument={null} activeTab="message" notificationLogs={[row]}
      onTabChange={jest.fn()} onMessage={jest.fn()} onIssueContract={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()} />);
    const button = screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ });
    expect(button).toHaveTextContent("발송 실패");
    await userEvent.setup().click(button);
    expect(screen.getByText(historyLookup === "checking" ? "확인 중" : "확인 필요")).toBeInTheDocument();
  });
});

describe("customer message retry", () => {
  const row: ClientNotificationLogRecord = {
    id: 901, provider: "aligo_sms", templateKey: "service_record_link_sms", status: "failed",
    receiver: "01012345678", messageBody: "내용", recipientName: "고객", clientId: 7,
    errorMessage: null, ruleName: null, createdAt: "2026-10-12T00:00:00Z",
  };
  beforeEach(() => {
    mockMessageBranchRole = "manager";
    mockRetryHistory.mockReset().mockResolvedValue({ status: "sent" });
    mockResendJob.mockReset().mockResolvedValue({ status: "sent" });
  });
  afterEach(() => { mockMessageBranchRole = "manager"; });
  async function openRecord(status = "failed", overrides: Partial<ClientNotificationLogRecord> = {}) {
    render(<ClientDetailContent data-component="mobile_clients_detail-sheet_content"
      client={client} activeTab="message" notificationLogs={[{ ...row, status, ...overrides }]}
      onTabChange={jest.fn()} onMessage={jest.fn()} onIssueContract={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ }));
  }
  it("confirms before retrying the numeric log id and closes the snapshot", async () => {
    await openRecord();
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    expect(mockRetryHistory).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("메시지를 다시 보낼까요?");
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await waitFor(() => expect(mockRetryHistory).toHaveBeenCalledWith(901));
    expect(mockUseRetryHistory).toHaveBeenCalledWith(client.id);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith({ variant: "success", description: "재발송 요청을 접수했어요" });
  });
  it.each(["sent", "pending", "canceled", "needs_setup"])("does not retry %s logs", async status => {
    await openRecord(status);
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
  it("does not offer retry to a staff member", async () => {
    mockMessageBranchRole = "staff";
    await openRecord();
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
  const jobRow = { id: "job:job-123", provider: "message_job", triggerJobId: "job-123" };
  it("confirms a needs_setup job resend with its bare job id and client context", async () => {
    await openRecord("needs_setup", jobRow);
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    expect(mockResendJob).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("메시지를 다시 보낼까요?");
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await waitFor(() => expect(mockResendJob).toHaveBeenCalledWith("job-123"));
    expect(mockUseResendJob).toHaveBeenCalledWith(client.id);
    expect(mockRetryHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "재발송", variant: "success" }));
  });
  it.each([null, "", "   "])("hides job resend without a usable triggerJobId (%s)", async triggerJobId => {
    await openRecord("needs_setup", { ...jobRow, triggerJobId });
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
  it.each(["sent", "pending", "failed", "canceled"])("hides job resend for %s", async status => {
    await openRecord(status, jobRow);
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
  it("hides needs_setup job resend for non-managers", async () => {
    mockMessageBranchRole = "staff";
    await openRecord("needs_setup", jobRow);
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
  it.each([
    ["sent", null, MESSAGE_JOB_RESEND_COPY.success, "success"],
    ["needs_setup", "새 설정 사유", MESSAGE_JOB_RESEND_COPY.stillNeedsSetup, "destructive"],
    ["canceled", "발송 취소 사유", `${MESSAGE_JOB_RESEND_COPY.notSent} 발송 취소 사유`, "destructive"],
    ["canceled", null, MESSAGE_JOB_RESEND_COPY.notSent, "destructive"],
    ["failed", null, MESSAGE_JOB_RESEND_COPY.failure, "destructive"],
  ])("matches global resend feedback for %s (%s)", async (status, reason, description, variant) => {
    mockResendJob.mockResolvedValue({ status, reason });
    await openRecord("needs_setup", jobRow);
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: MESSAGE_JOB_RESEND_COPY.action, description, variant }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    if (status === "needs_setup") {
      expect(screen.getByText("새 설정 사유")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "재발송" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "목록으로" })).not.toBeInTheDocument();
    }
  });
  it.each([409, 500])("uses safe error copy for HTTP %s and closes the snapshot", async status => {
    mockResendJob.mockRejectedValue(new AxiosError("internal", "ERR_BAD_REQUEST", undefined, undefined, {
      status, statusText: "Error", data: { message: "internal" }, headers: {}, config: { headers: new AxiosHeaders() },
    }));
    await openRecord("needs_setup", jobRow);
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "재발송" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: MESSAGE_JOB_RESEND_COPY.action, variant: "destructive",
      description: status === 409 ? MESSAGE_JOB_RESEND_COPY.conflict : MESSAGE_JOB_RESEND_COPY.failure,
    }));
    expect(screen.queryByRole("button", { name: "목록으로" })).not.toBeInTheDocument();
  });
});

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/clients",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "user", branchRole: mockMessageBranchRole },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

const mockServiceRecordsQuery: {
  data: unknown;
  isError: boolean;
  isLoading: boolean;
  isPaused: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
} = { data: undefined, isError: false, isLoading: false, isPaused: false, isFetching: false, refetch: jest.fn() };
const mockServiceRecordsRenders: Array<{ isLoading: boolean; isError: boolean }> = [];

jest.mock("@/hooks/useServiceRecords", () => ({
  applyServiceScheduleChange: jest.fn(),
  fetchClientServiceRecords: jest.fn(),
  previewServiceScheduleChange: jest.fn(),
  resetServiceRecordLink: jest.fn(),
  useClientServiceRecords: () => mockServiceRecordsQuery,
}));

jest.mock("@/hooks/useClients", () => ({
  approveScheduleChange: jest.fn(),
  rejectScheduleChange: jest.fn(),
}));

jest.mock("@/features/clients", () => ({
  useConfirmBooking: () => ({ mutateAsync: jest.fn(), isPending: false }),
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

jest.mock("../client-service-records", () => ({
  ClientServiceRecords: (props: { isLoading: boolean; isError: boolean }) => {
    mockServiceRecordsRenders.push({ isLoading: props.isLoading, isError: props.isError });
    return null;
  },
}));

jest.mock("../ServiceRecordLinkResetResultModal", () => ({
  ServiceRecordLinkResetResultModal: () => null,
}));

jest.mock("../ServiceScheduleChangeModal", () => ({
  ServiceScheduleChangeModal: ({ onSubmit }: { onSubmit: (allow: boolean) => void }) => (
    <button onClick={() => onSubmit(false)}>일정 변경 적용</button>
  ),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn().mockResolvedValue({ fields: [] }), getLinkConfirmations: jest.fn().mockResolvedValue([]), voidDocument: jest.fn() },
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
  bookingConfirmedAt: null,
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

function contractDocumentWithDates({
  createdDate,
  updatedDate = Date.parse("2026-09-25T12:00:00Z"),
  fields = [],
}: {
  createdDate: unknown;
  updatedDate?: unknown;
  fields?: unknown[];
}): EformsignDocument {
  return {
    id: "document-1",
    document_number: "DOC-1",
    template: { id: "template-1", name: "Test Template" },
    document_name: "Test Document",
    creator: { recipient_type: "01", id: "creator@test.com", name: "Creator" },
    created_date: createdDate as number,
    last_editor: { recipient_type: "01", id: "editor@test.com", name: "Editor" },
    updated_date: updatedDate as number,
    current_status: {
      status_type: "060",
      status_doc_type: "doc",
      status_doc_detail: "detail",
      step_type: "05",
      step_index: "1",
      step_name: "Step 1",
      step_recipients: [],
      step_group: 1,
      expired_date: 0,
      _expired: false,
    },
    fields,
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  };
}

describe("contract void workflow", () => {
  const linkedClient: Client = { ...client, eDocId: "document-1", latestContractDocumentId: "document-1", documentStatus: "requested", hasSigned: true };
  const voidedAt = "2026-10-14T01:02:00Z";
  const document = (display_status: string): EformsignDocument => ({
    ...contractDocumentWithDates({ createdDate: Date.parse("2026-10-01T00:00:00Z") }),
    display_status,
  });
  const refresh = jest.fn();
  function renderVoid(doc = document("signed"), target = linkedClient) {
    return render(<ClientDetailContent data-component="mobile_clients_detail-sheet_content"
      client={target} contractDocument={doc} activeTab="contracts" onContractVoided={refresh}
      onTabChange={jest.fn()} onMessage={jest.fn()} onIssueContract={jest.fn()}
      onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()} />);
  }
  beforeEach(() => {
    jest.mocked(eformsignApi.voidDocument).mockReset();
    jest.mocked(toast).mockClear();
    refresh.mockClear();
  });
  it.each(["003", "060"])("voided overrides provider code %s and shows time/name with no action", (code) => {
    const doc = document("voided");
    doc.current_status.status_type = code;
    doc.voided_at = voidedAt;
    doc.voided_by_name = "담당자";
    renderVoid(doc, { ...linkedClient, hasSigned: false });
    expect(screen.getAllByText("파기됨").length).toBeGreaterThan(0);
    expect(screen.getByText("파기")).toBeInTheDocument();
    expect(screen.getByText(`${formatMessageDateTimeCompact(voidedAt)} · 담당자`)).toBeInTheDocument();
    expect(screen.getByText("서명 대기자").parentElement).toHaveTextContent("-");
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
    expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
  });
  it("uses the void timestamp even when display status lags and the actor is unknown", () => {
    renderVoid({ ...document("signed"), voided_at: voidedAt, voided_by_name: null });
    expect(screen.getByText(`${formatMessageDateTimeCompact(voidedAt)} · 알 수 없음`)).toBeInTheDocument();
    expect(screen.getAllByText("파기됨").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
  });
  it("honors display_status voided without a timestamp regardless of a completed code", () => {
    const doc = document("voided");
    doc.current_status.status_type = "003";
    renderVoid(doc, { ...linkedClient, documentStatus: "completed" });
    expect(screen.getAllByText("파기됨").length).toBeGreaterThan(0);
    expect(screen.queryByText("계약 완료")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
  });
  it("uses only the coarse voided status when no document is loaded", () => {
    renderDetail(null, { ...linkedClient, documentStatus: "voided" }, "contracts");
    expect(screen.getAllByText("파기됨").length).toBeGreaterThan(0);
    expect(screen.queryByText("파기")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
  });
  it.each(["revoked", "expired"])("does not offer void for %s", (status) => {
    renderVoid(document(status));
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
  });
  it("does not void an older linked document or inherit the latest contract's voided badge", () => {
    renderVoid(document("signed"), { ...linkedClient, latestContractDocumentId: "newer", documentStatus: "voided" });
    expect(screen.getAllByText("서명 완료").length).toBeGreaterThan(0);
    expect(screen.queryByText("파기됨")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CONTRACT_VOID_COPY.action })).not.toBeInTheDocument();
  });
  it("keeps the loaded document's status even when the same client's coarse status is voided", () => {
    renderVoid(document("signed"), { ...linkedClient, documentStatus: "voided" });
    expect(screen.queryByText("파기됨")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: CONTRACT_VOID_COPY.action })).toBeInTheDocument();
  });
  it("shows shared confirmation copy and cancels without a request", async () => {
    renderVoid();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.action }));
    expect(screen.getByRole("dialog")).toHaveTextContent(CONTRACT_VOID_COPY.confirmTitle);
    expect(screen.getByRole("dialog")).toHaveTextContent(CONTRACT_VOID_COPY.confirmDescription);
    expect(screen.getByRole("button", { name: CONTRACT_VOID_COPY.cancel })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.cancel }));
    expect(eformsignApi.voidDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("submits once, disables pending actions, ignores dismissal, and refreshes on success", async () => {
    let resolve!: (response: Awaited<ReturnType<typeof eformsignApi.voidDocument>>) => void;
    jest.mocked(eformsignApi.voidDocument).mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderVoid();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.action }));
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.confirm }));
    const pending = screen.getByRole("button", { name: CONTRACT_VOID_COPY.pending });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: CONTRACT_VOID_COPY.cancel })).toBeDisabled();
    await user.click(pending);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(eformsignApi.voidDocument).toHaveBeenCalledTimes(1);
    expect(eformsignApi.voidDocument).toHaveBeenCalledWith("document-1");
    await act(async () => resolve({ documentId: "document-1", voidedAt, voidedByName: null, displayStatus: "voided" }));
    expect(toast).toHaveBeenCalledWith({ title: CONTRACT_VOID_COPY.success });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([
    [409, { isAxiosError: true, response: { status: 409 } }, CONTRACT_VOID_COPY.conflict, false],
    [500, { isAxiosError: true, response: { status: 500 } }, CONTRACT_VOID_COPY.failure, true],
    ["network", new Error("network"), CONTRACT_VOID_COPY.failure, true],
  ])("refreshes after %s and preserves the correct modal state", async (_name, error, copy, staysOpen) => {
    jest.mocked(eformsignApi.voidDocument).mockRejectedValue(error);
    renderVoid();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.action }));
    await user.click(screen.getByRole("button", { name: CONTRACT_VOID_COPY.confirm }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: copy, variant: "destructive" });
    if (staysOpen) expect(screen.getByRole("dialog")).toBeInTheDocument();
    else expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ClientDetailContent", () => {
  it("leaves the payment date blank when the old document fetch fails during reissue", async () => {
    const { fetchClientServiceRecords, previewServiceScheduleChange, applyServiceScheduleChange } = await import("@/hooks/useServiceRecords");
    const { eformsignApi } = await import("@/services/api");
    jest.mocked(fetchClientServiceRecords).mockResolvedValue({ assignments: [{ scheduleId: 7, replaced: false }] } as never);
    jest.mocked(previewServiceScheduleChange).mockResolvedValue({
      fromDate: "2026-10-05", minimumDate: "2026-10-05", sessionIndex: 1,
    } as never);
    jest.mocked(applyServiceScheduleChange).mockResolvedValue({ newEndDate: "2026-10-30" } as never);
    jest.mocked(eformsignApi.getDocument).mockRejectedValueOnce(new Error("Document unavailable"));
    useFormStore.getState().resetAll();
    const { result } = renderHook(() => useIssueContract());
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail"
        client={{ ...client, eDocId: "old-document", documentStatus: "completed" }}
        activeTab="basic"
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={result.current}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "고객 옵션" }));
    await user.click(screen.getByText("서비스 일정 변경"));
    await user.click(await screen.findByText("일정 변경 적용"));
    await user.click(await screen.findByText("수정 전송"));

    expect(eformsignApi.getDocument).toHaveBeenCalledWith("old-document");
    expect(useFormStore.getState().paymentDate).toBe("");
    expect(useFormStore.getState().isContractReissue).toBe(true);
    expect(useFormStore.getState().supersede).toBeNull();
  });
  it.each([
    ["requested", "latest-document"],
    ["completed", undefined],
  ] as const)("reissues using the latest document's %s status, not the stale pin", async (documentStatus, expected) => {
    const { eformsignApi } = await import("@/services/api");
    const { fetchClientServiceRecords, previewServiceScheduleChange, applyServiceScheduleChange } = await import("@/hooks/useServiceRecords");
    jest.mocked(fetchClientServiceRecords).mockResolvedValue({
      assignments: [{ scheduleId: 7, replaced: false }],
    } as never);
    jest.mocked(previewServiceScheduleChange).mockResolvedValue({
      fromDate: "2026-10-05", minimumDate: "2026-10-05", sessionIndex: 1,
    } as never);
    jest.mocked(applyServiceScheduleChange).mockResolvedValue({ newEndDate: "2026-10-30" } as never);
    const target = {
      ...client, eDocId: "old-document", latestContractDocumentId: "latest-document", documentStatus,
    };
    const onIssueContract = jest.fn();
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail"
        client={target}
        activeTab="basic"
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={onIssueContract}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "고객 옵션" }));
    await user.click(screen.getByText("서비스 일정 변경"));
    await user.click(await screen.findByText("일정 변경 적용"));
    await user.click(await screen.findByText("수정 전송"));

    expect(onIssueContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      supersedeDocumentId: expected,
    }));
    expect(eformsignApi.getDocument).toHaveBeenLastCalledWith("latest-document");
  });
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
  it.each([
    ["unsigned", false, "서명 요청됨", "서명 완료"],
    ["signed while provider review is pending", true, "서명 완료", "서명 요청됨"],
  ])("labels the %s contract stage from hasSigned", (_state, hasSigned, shown, hidden) => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned,
      documentStatus: "requested" as const,
    };
    const contractDocument = {
      id: "document-1",
      current_status: { status_type: "070", step_type: "06", step_name: "제공기관 확인" },
    } as EformsignDocument;

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("현재 단계").closest("div")).toHaveTextContent(shown);
    expect(screen.queryAllByText(hidden)).toHaveLength(0);
  });
  it.each([
    ["display_status", { display_status: "rejected_by_reviewer" }],
    ["the 071 status code when display_status is absent", {}],
  ])("shows a rejected contract as 반려됨 with the solid badge, from %s — never 서명 완료", (_source, extra) => {
    // The backend reports a 071 contract as documentStatus requested + hasSigned, which the coarse
    // summary alone would read as 서명 완료.
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "requested" as const,
    };
    const contractDocument = {
      id: "document-1",
      current_status: { status_type: "071", step_type: "06", step_name: "제공기관 확인" },
      ...extra,
    } as EformsignDocument;

    const { container } = renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("현재 단계").closest("div")).toHaveTextContent("반려됨");
    expect(screen.queryAllByText("서명 완료")).toHaveLength(0);
    const cardBadge = container.querySelector(
      '[data-component$="_contract-card_doc-row"] .badge-mini',
    );
    expect(cardBadge).toHaveTextContent("반려됨");
    expect(cardBadge).toHaveClass("burgundy-solid");
  });

  it.each([
    ["signed", "070", "signed", "서명 완료", "green"],
    ["review", "060", "review", "검토 필요", "orange"],
    ["pending", "060", "pending", "서명 대기", "primary"],
  ])("shows the latest contract's own %s status, never the coarse client summary", (_state, statusType, displayStatus, label, tone) => {
    // The summary reads 서명 완료 whenever hasSigned, which includes a contract still at the
    // provider-review step; the document's display status must decide, as on the list and desktop.
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "requested" as const,
    };
    const contractDocument = {
      id: "document-1",
      display_status: displayStatus,
      current_status: {
        status_type: statusType,
        step_type: "06",
        step_name: "제공기관 확인",
      },
    } as EformsignDocument;

    const { container } = renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("현재 단계").closest("div")).toHaveTextContent(label);
    if (label !== "서명 완료") expect(screen.queryAllByText("서명 완료")).toHaveLength(0);
    expect(screen.queryAllByText("반려됨")).toHaveLength(0);
    const cardBadge = container.querySelector(
      '[data-component$="_contract-card_doc-row"] .badge-mini',
    );
    expect(cardBadge).toHaveTextContent(label);
    expect(cardBadge).toHaveClass(tone);
    expect(cardBadge).not.toHaveClass("burgundy-solid");
  });

  it("labels an unassigned latest contract the way the desktop card does", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "requested" as const,
    };
    const contractDocument = {
      id: "document-1",
      display_status: "unassigned",
      current_status: { status_type: "060", step_type: "06", step_name: "제공기관 확인" },
    } as EformsignDocument;

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("현재 단계").closest("div")).toHaveTextContent("고객 등록 필요");
  });

  it("falls back to the client summary when there is no contract document", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "requested" as const,
    };

    renderDetail(null, detailClient, "contracts");

    expect(screen.getByText("현재 단계").closest("div")).toHaveTextContent("서명 완료");
    expect(screen.queryAllByText("반려됨")).toHaveLength(0);
  });

  it("does not supersede a signed contract that still reports documentStatus requested", async () => {
    const { fetchClientServiceRecords, previewServiceScheduleChange, applyServiceScheduleChange } = await import("@/hooks/useServiceRecords");
    jest.mocked(fetchClientServiceRecords).mockResolvedValue({
      assignments: [{ scheduleId: 7, replaced: false }],
    } as never);
    jest.mocked(previewServiceScheduleChange).mockResolvedValue({
      fromDate: "2026-10-05", minimumDate: "2026-10-05", sessionIndex: 1,
    } as never);
    jest.mocked(applyServiceScheduleChange).mockResolvedValue({ newEndDate: "2026-10-30" } as never);
    const onIssueContract = jest.fn();
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail"
        client={{
          ...client, eDocId: "old-document", latestContractDocumentId: "latest-document",
          documentStatus: "requested", hasSigned: true,
        }}
        activeTab="basic"
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={onIssueContract}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "고객 옵션" }));
    await user.click(screen.getByText("서비스 일정 변경"));
    await user.click(await screen.findByText("일정 변경 적용"));
    await user.click(await screen.findByText("수정 전송"));

    expect(onIssueContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      supersedeDocumentId: undefined,
    }));
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

  it("uses the document created date for both non-completed sent-date labels", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      startDate: "2026-09-21",
      documentStatus: "requested" as const,
    };
    const contractDocument = contractDocumentWithDates({
      createdDate: Date.parse("2026-09-18T12:00:00Z"),
    });

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("발송 날짜 2026.09.18")).toBeInTheDocument();
    expect(screen.getByText("발송일").closest("div")).toHaveTextContent("2026.09.18");
    expect(screen.queryByText("발송 날짜 2026.09.21")).not.toBeInTheDocument();
  });

  it.each([
    ["null created date", null],
    ["zero created date", 0],
    ["invalid created date", "not-a-timestamp"],
    ["non-numeric created date", Number.NaN],
  ])("shows unknown sent dates when %s despite a valid service start", (_label, createdDate) => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      startDate: "2026-09-21",
      documentStatus: "requested" as const,
    };
    const contractDocument = contractDocumentWithDates({ createdDate });

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("발송 날짜 -")).toBeInTheDocument();
    expect(screen.getByText("발송일").closest("div")).toHaveTextContent("-");
    expect(screen.queryByText("2026.09.21")).not.toBeInTheDocument();
  });

  it("shows unknown sent dates when the document and service start dates are missing", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      startDate: null,
      documentStatus: "requested" as const,
    };
    renderDetail(null, detailClient, "contracts");

    expect(screen.getByText("발송 날짜 -")).toBeInTheDocument();
    expect(screen.getByText("발송일").closest("div")).toHaveTextContent("-");
  });

  it("keeps the completed date derivation while using created date for the sent row", () => {
    const detailClient = {
      ...client,
      eDocId: "document-1",
      startDate: "2026-09-21",
      hasSigned: true,
      documentStatus: "completed" as const,
    };
    const contractDocument = contractDocumentWithDates({
      createdDate: Date.parse("2026-09-18T12:00:00Z"),
      updatedDate: Date.parse("2026-09-25T12:00:00Z"),
      fields: [{ id: "계약 서명 날짜", value: "20260923" }],
    });

    renderDetail(contractDocument, detailClient, "contracts");

    expect(screen.getByText("완료 날짜 2026.09.25")).toBeInTheDocument();
    expect(screen.getByText("발송일").closest("div")).toHaveTextContent("2026.09.18");
    expect(screen.getByText("완료일").closest("div")).toHaveTextContent("2026.09.25");
    expect(screen.queryByText("2026.09.21")).not.toBeInTheDocument();
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

  it("uses the effective message time for ordering, rows, and opened detail", async () => {
    const canceledLog: ClientNotificationLogRecord = {
      id: 51,
      provider: "aligo_sms",
      templateKey: "service_record_link_sms",
      receiver: "01012345678",
      recipientPhone: "01012345678",
      recipientName: "관리사",
      clientId: client.id,
      status: "canceled",
      messageBody: "제공기록지 작성 링크",
      errorMessage: "취소됨",
      createdAt: "2026-09-18T17:32:00.000Z",
      lastAttemptAt: "2026-09-18T18:34:00.000Z",
      updatedAt: "2026-09-18T18:20:00.000Z",
      ruleName: "제공기록지 작성 링크",
      variables: {},
    };
    const legacyLog: ClientNotificationLogRecord = {
      id: 52,
      provider: "aligo_sms",
      templateKey: "manual_sms",
      receiver: "01012345678",
      recipientPhone: "01012345678",
      recipientName: "관리사",
      clientId: client.id,
      status: "sent",
      messageBody: "수동 메시지",
      errorMessage: null,
      createdAt: "2026-09-18T18:10:00.000Z",
      ruleName: null,
      variables: {},
    };

    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[legacyLog, canceledLog]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    const messageRows = screen.getAllByRole("button").filter((row) => row.textContent?.includes("메시지 ·"));
    expect(messageRows[0]).toHaveTextContent("제공기록지 작성 링크");
    const rowTime = messageRows[0].querySelector(".doc-meta")?.textContent;
    expect(rowTime).toBeTruthy();

    await userEvent.setup().click(messageRows[0]);

    expect(screen.getByText(`메시지 · ${rowTime}`)).toBeInTheDocument();
  });

  it("falls back to updatedAt for a canceled row when lastAttemptAt is absent", async () => {
    const log: ClientNotificationLogRecord = {
      id: 54,
      provider: "aligo_sms",
      templateKey: "service_record_link_sms",
      receiver: "01012345678",
      recipientPhone: "01012345678",
      recipientName: "관리사",
      clientId: client.id,
      status: "canceled",
      messageBody: "제공기록지 작성 링크",
      errorMessage: "사용자가 발송을 취소했습니다.",
      createdAt: "2026-09-18T17:32:00.000Z",
      lastAttemptAt: null,
      updatedAt: "2026-09-18T18:34:00.000Z",
      ruleName: "제공기록지 작성 링크",
      variables: {},
    };
    const expectedUpdatedTime = formatMessageDateTimeCompact(log.updatedAt ?? null);
    const createdTime = formatMessageDateTimeCompact(log.createdAt);

    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[log]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ });
    expect(expectedUpdatedTime).not.toBe(createdTime);
    expect(row.querySelector(".doc-meta")).toHaveTextContent(expectedUpdatedTime);
    expect(row.querySelector(".doc-meta")).not.toHaveTextContent(createdTime);

    await userEvent.setup().click(row);

    expect(screen.getByText(`메시지 · ${expectedUpdatedTime}`)).toBeInTheDocument();
    expect(screen.queryByText(`메시지 · ${createdTime}`)).not.toBeInTheDocument();
  });

  it.each([
    ["canceled", "취소 사유", "사용자가 발송을 취소했습니다."],
    ["failed", "실패 사유", "발신번호 인증에 실패했습니다."],
    ["needs_setup", "추가 필요 정보", "연락처가 연결되지 않았습니다."],
  ] as const)("shows only the %s reason in the real history detail", async (status, reasonLabel, reason) => {
    const view = render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[{
          id: status === "canceled" ? 61 : 62,
          provider: "aligo_sms",
          templateKey: "service_record_link_sms",
          receiver: "01012345678",
          recipientPhone: "01012345678",
          recipientName: "관리사",
          clientId: client.id,
          status,
          messageBody: "제공기록지 작성 링크",
          errorMessage: reason,
          createdAt: "2026-09-18T18:34:00.000Z",
          ruleName: "제공기록지 작성 링크",
          variables: {},
        }]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ }));

    expect(screen.getByText(reasonLabel)).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    for (const otherLabel of ["실패 사유", "취소 사유", "추가 필요 정보"]) {
      if (otherLabel !== reasonLabel) expect(screen.queryByText(otherLabel)).not.toBeInTheDocument();
    }
    // The same numeric failed-log rule as the global messages page applies.
    expect(Boolean(screen.queryByRole("button", { name: "재발송" }))).toBe(status === "failed");
    view.unmount();
  });

  it("does not show a reason for a sent message in the real history detail", async () => {
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[{
          id: 63,
          provider: "aligo_sms",
          templateKey: "service_record_link_sms",
          receiver: "01012345678",
          recipientPhone: "01012345678",
          recipientName: "관리사",
          clientId: client.id,
          status: "sent",
          messageBody: "제공기록지 작성 링크",
          errorMessage: "이 값은 표시되면 안 됩니다.",
          createdAt: "2026-09-18T18:34:00.000Z",
          ruleName: "제공기록지 작성 링크",
          variables: {},
        }]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ }));

    expect(screen.queryByText("실패 사유")).not.toBeInTheDocument();
    expect(screen.queryByText("취소 사유")).not.toBeInTheDocument();
    expect(screen.queryByText("이 값은 표시되면 안 됩니다.")).not.toBeInTheDocument();
  });
  it("says only recent records are shown when the server holds older ones", () => {
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[{
          id: 70,
          provider: "aligo_sms",
          templateKey: "service_record_link_sms",
          receiver: "01012345678",
          recipientPhone: "01012345678",
          recipientName: "관리사",
          clientId: client.id,
          status: "sent",
          messageBody: "제공기록지 작성 링크",
          errorMessage: null,
          createdAt: "2026-09-18T18:34:00.000Z",
          ruleName: "제공기록지 작성 링크",
          variables: {},
        }]}
        hasMoreNotificationLogs
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    expect(screen.getByText("최근 발송 기록만 표시하고 있어요")).toBeInTheDocument();
  });

  it("shows no truncation notice for a complete history", () => {
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[]}
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    expect(screen.queryByText("최근 발송 기록만 표시하고 있어요")).not.toBeInTheDocument();
  });

  it("does not show the truncation notice over a failed history load", () => {
    render(
      <ClientDetailContent
        data-component="mobile_clients_detail-sheet_stack_detail-page_content"
        client={client}
        contractDocument={null}
        activeTab="message"
        notificationLogs={[]}
        hasMoreNotificationLogs
        isNotificationLogsError
        onTabChange={jest.fn()}
        onMessage={jest.fn()}
        onIssueContract={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onClientUpdated={jest.fn()}
      />,
    );

    expect(screen.getByText("발송 내역을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("최근 발송 기록만 표시하고 있어요")).not.toBeInTheDocument();
  });

  describe("failed history refetch over cached logs", () => {
    const cachedLog: ClientNotificationLogRecord = {
      id: 902, provider: "aligo_sms", templateKey: "service_record_link_sms", status: "sent",
      receiver: "01012345678", messageBody: "내용", variables: {},
      recipientName: null, clientId: null, errorMessage: null, ruleName: "제공기록지 작성 링크",
      createdAt: "2026-10-12T00:00:00Z",
    };
    const renderMessageTab = (props: Record<string, unknown>) =>
      render(
        <ClientDetailContent
          data-component="mobile_clients_detail-sheet_stack_detail-page_content"
          client={client}
          contractDocument={null}
          activeTab="message"
          onTabChange={jest.fn()}
          onMessage={jest.fn()}
          onIssueContract={jest.fn()}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          onClientUpdated={jest.fn()}
          {...props}
        />,
      );

    it("keeps the cached logs and shows a notice whose retry refetches", async () => {
      const onRetryNotificationLogs = jest.fn();
      renderMessageTab({ notificationLogs: [cachedLog], isNotificationLogsError: true, onRetryNotificationLogs });

      const row = screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ });
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
      expect(alert).toHaveAttribute("data-size", "inline");
      // The notice sits above the cached rows, and the no-data error UI is not used.
      expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText("발송 내역을 불러오지 못했습니다.")).not.toBeInTheDocument();

      await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));
      expect(onRetryNotificationLogs).toHaveBeenCalledTimes(1);
    });

    it("disables the notice's retry while a refetch is in flight", () => {
      renderMessageTab({
        notificationLogs: [cachedLog],
        isNotificationLogsError: true,
        isNotificationLogsRetrying: true,
        onRetryNotificationLogs: jest.fn(),
      });

      expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    });

    it("shows no notice over cached logs when the load succeeded", () => {
      renderMessageTab({ notificationLogs: [cachedLog] });

      expect(screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    describe("while a message detail is open", () => {
      const detailProps = (extra: Record<string, unknown> = {}) => ({
        notificationLogs: [{ ...cachedLog, messageBody: "열린 메시지 본문" }],
        onRetryNotificationLogs: jest.fn(),
        ...extra,
      });
      const renderOpenDetail = async (extra: Record<string, unknown> = {}) => {
        const props = detailProps(extra);
        const view = renderMessageTab(props);
        await userEvent.setup().click(screen.getByRole("button", { name: /메시지 · 제공기록지 작성 링크/ }));
        expect(screen.getByText("열린 메시지 본문")).toBeInTheDocument();
        return { view, props };
      };
      const rerenderWith = (view: ReturnType<typeof renderMessageTab>, props: Record<string, unknown>) =>
        view.rerender(
          <ClientDetailContent
            data-component="mobile_clients_detail-sheet_stack_detail-page_content"
            client={client}
            contractDocument={null}
            activeTab="message"
            onTabChange={jest.fn()}
            onMessage={jest.fn()}
            onIssueContract={jest.fn()}
            onEdit={jest.fn()}
            onDelete={jest.fn()}
            onClientUpdated={jest.fn()}
            {...props}
          />,
        );

      it("shows the notice above the kept message body after a failed refetch, and its retry refetches", async () => {
        const { view, props } = await renderOpenDetail();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        rerenderWith(view, { ...props, isNotificationLogsError: true });

        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        expect(alert).toHaveAttribute("data-size", "inline");
        const body = screen.getByText("열린 메시지 본문");
        expect(alert.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));
        expect(props.onRetryNotificationLogs).toHaveBeenCalledTimes(1);
      });

      it("disables the notice's retry while a refetch is in flight", async () => {
        const { view, props } = await renderOpenDetail();

        rerenderWith(view, { ...props, isNotificationLogsError: true, isNotificationLogsRetrying: true });

        expect(screen.getByText("열린 메시지 본문")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
      });

      it("shows no notice over the open detail when the load succeeded", async () => {
        await renderOpenDetail();

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
    });

    it("keeps the truncation notice over cached logs after a failed refetch", () => {
      renderMessageTab({ notificationLogs: [cachedLog], hasMoreNotificationLogs: true, isNotificationLogsError: true });

      expect(screen.getByText("최근 발송 기록만 표시하고 있어요")).toBeInTheDocument();
    });
  });

  describe("detail-empty-state slot", () => {
    const baseProps = {
      "data-component": "mobile_clients_detail-sheet_stack_detail-page_content",
      client,
      contractDocument: null,
      onTabChange: jest.fn(),
      onMessage: jest.fn(),
      onIssueContract: jest.fn(),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onClientUpdated: jest.fn(),
    } as const;
    const slotted = (container: HTMLElement) =>
      Array.from(container.querySelectorAll(".detail-empty-state"));

    it.each([
      ["loading", { isNotificationLogsLoading: true }],
      ["error", { isNotificationLogsError: true }],
      ["empty", {}],
    ] as const)("marks the %s message history state with data-slot", (_name, flags) => {
      const { container } = render(
        <ClientDetailContent {...baseProps} activeTab="message" notificationLogs={[]} {...flags} />,
      );
      const states = slotted(container);
      expect(states).toHaveLength(1);
      expect(states[0]).toHaveAttribute("data-slot", "detail-empty-state");
    });

    it("marks the truncation notice and the empty contract card with data-slot", () => {
      const truncated = render(
        <ClientDetailContent
          {...baseProps}
          activeTab="message"
          notificationLogs={[]}
          hasMoreNotificationLogs
        />,
      );
      const notices = slotted(truncated.container);
      expect(notices.length).toBeGreaterThan(0);
      for (const element of notices) expect(element).toHaveAttribute("data-slot", "detail-empty-state");
      truncated.unmount();

      const contracts = render(<ClientDetailContent {...baseProps} activeTab="contracts" notificationLogs={[]} />);
      const cards = slotted(contracts.container);
      expect(cards.length).toBeGreaterThan(0);
      for (const element of cards) expect(element).toHaveAttribute("data-slot", "detail-empty-state");
    });
  });
});

describe("service records tab: a load that has not succeeded is never an empty result (BJJ-434)", () => {
  const baseProps = {
    "data-component": "mobile_clients_detail-sheet_stack_detail-page_content",
    client,
    contractDocument: null,
    onTabChange: jest.fn(),
    onMessage: jest.fn(),
    onIssueContract: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onClientUpdated: jest.fn(),
  } as const;
  const lastRender = () => mockServiceRecordsRenders[mockServiceRecordsRenders.length - 1];

  beforeEach(() => {
    mockServiceRecordsRenders.length = 0;
    Object.assign(mockServiceRecordsQuery, {
      data: undefined, isError: false, isLoading: false, isPaused: false, isFetching: false,
    });
  });

  it("passes loading to the tab for a first load paused by the offline pause", () => {
    Object.assign(mockServiceRecordsQuery, { isPaused: true });
    render(<ClientDetailContent {...baseProps} activeTab="serviceRecords" />);

    expect(lastRender()).toEqual({ isLoading: true, isError: false });
  });

  it("does not hold the skeleton over cached data when a refetch is paused", () => {
    Object.assign(mockServiceRecordsQuery, { isPaused: true, data: { assignments: [] } });
    render(<ClientDetailContent {...baseProps} activeTab="serviceRecords" />);

    expect(lastRender()).toEqual({ isLoading: false, isError: false });
  });

  it("keeps a real first load as loading and a settled query as not loading", () => {
    Object.assign(mockServiceRecordsQuery, { isLoading: true });
    const loading = render(<ClientDetailContent {...baseProps} activeTab="serviceRecords" />);
    expect(lastRender()).toEqual({ isLoading: true, isError: false });
    loading.unmount();

    Object.assign(mockServiceRecordsQuery, { isLoading: false, data: { assignments: [] } });
    render(<ClientDetailContent {...baseProps} activeTab="serviceRecords" />);
    expect(lastRender()).toEqual({ isLoading: false, isError: false });
  });
});
