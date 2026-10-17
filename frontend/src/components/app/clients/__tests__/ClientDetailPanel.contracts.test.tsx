import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";

import { clientKeys } from "@/features/clients/hooks/keys";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import { ClientDetailPanel } from "../ClientDetailPanel";
import type { Client } from "@/lib/client/types";
import { eformsignApi } from "@/services/api";
import type { EformsignLinkConfirmation } from "@/services/eformsign";

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useApproveScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useRejectScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useConfirmBooking: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => {
    const emptyList = {
        items: [],
        isError: false,
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: jest.fn(),
        refetch: jest.fn(),
    };
    return {
        useClientMessageHistory: () => emptyList,
        useClientUpcomingMessageTriggerJobs: () => emptyList,
    };
});

jest.mock("@/features/service-records/hooks/use-service-records", () => ({
    useClientServiceRecords: () => ({ data: undefined, isError: false, isLoading: false }),
    useClientServiceRecordRevisionHistory: () => ({
        data: undefined,
        error: undefined,
        isError: false,
        isLoading: false,
        isFetching: false,
        refetch: jest.fn(),
    }),
    useRetryServiceRecordDocument: () => ({
        isPending: false,
        variables: undefined,
        mutateAsync: jest.fn(),
    }),
}));

// Display-only calendar: keep the real holiday API (and its network calls) out of this test.
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
    useBusinessDayCalendar: () => ({
        calendar: jest.requireActual("@/lib/date/business-days").KR_BUILTIN_CALENDAR,
    }),
}));

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn(),
        getLinkConfirmations: jest.fn(),
        adoptDocument: jest.fn(),
        voidContractDocument: jest.fn(),
    },
}));

// The real modal loads a PDF viewer; the card only has to hand it the adapted document.
jest.mock("@/components/app/contracts/ContractDocumentPreviewModal", () => ({
    ContractDocumentPreviewModal: ({
        open,
        document: previewDocument,
        customerName,
    }: {
        open: boolean;
        document: {
            id: string;
            document_name: string;
            created_date: number;
            document_number: string;
            template?: { name?: string };
        } | null;
        customerName?: string | null;
    }) =>
        open && previewDocument ? (
            <div data-testid="preview-modal">
                <span data-testid="preview-id">{previewDocument.id}</span>
                <span data-testid="preview-name">{previewDocument.document_name}</span>
                <span data-testid="preview-created">{String(previewDocument.created_date)}</span>
                <span data-testid="preview-number">{previewDocument.document_number}</span>
                <span data-testid="preview-template">{previewDocument.template?.name ?? ""}</span>
                <span data-testid="preview-customer">{customerName}</span>
            </div>
        ) : null,
}));

jest.mock("@/components/app/messages/MessageHistoryDetailPanel", () => ({
    getMessageHistoryTimestamp: () => "",
    formatMessageHistoryDate: (value: string) => value,
    MESSAGE_HISTORY_STATUS_META: {},
    normalizeMessageHistoryRecord: () => ({}),
    MessageHistoryDetailPanel: () => null,
}));

jest.mock("@/components/app/clients/ClientServiceRecordsTab", () => ({
    ClientServiceRecordsTab: () => null,
}));

jest.mock("@/components/app/v3", () => ({
    AnimatedSlotList: () => null,
    AnimatedSlotListItemContent: () => null,
    DetailEmptyState: ({ message, action }: { message: string; action?: ReactNode }) => (
        <div data-testid="detail-empty-state">
            <p>{message}</p>
            {action}
        </div>
    ),
    DetailPanel: ({ children, tabs }: { children: ReactNode; tabs?: ReactNode }) => <main>{tabs}{children}</main>,
    DetailTabPanels: ({ activeTab, panels }: { activeTab: string; panels: Array<{ key: string; children: ReactNode }> }) => (
        <>{panels.find((panel) => panel.key === activeTab)?.children}</>
    ),
    DetailTabs: ({
        tabs,
        onTabChange,
    }: {
        tabs: Array<{ key: string; label: ReactNode }>;
        onTabChange: (key: string) => void;
    }) => (
        <nav>
            {tabs.map((tab) => (
                <button key={tab.key} type="button" onClick={() => onTabChange(tab.key)}>
                    {tab.label}
                </button>
            ))}
        </nav>
    ),
    InfoCard: ({ title, children }: { title?: ReactNode; children: ReactNode }) => (
        <section data-testid="contract-card"><h4>{title}</h4>{children}</section>
    ),
    InfoRow: ({ label, value }: { label: string; value: ReactNode }) => <div><span>{label}</span><span>{value}</span></div>,
    StatusBadge: ({ status, label }: { status: string; label: string }) => (
        <span data-testid="status-badge" data-status={status}>{label}</span>
    ),
}));

const getDocuments = eformsignApi.getDocumentsByClientId as jest.Mock;
const getLinkConfirmations = eformsignApi.getLinkConfirmations as jest.Mock;
const voidContractDocument = eformsignApi.voidContractDocument as jest.Mock;

const client: Client = {
    id: 1,
    name: "김고객",
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: "01011112222",
    primaryEmployee: null,
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

const contractDoc = {
    documentId: "doc-1",
    documentKind: "contract",
    stepRecipientName: "김고객",
    stepName: "고객 서명",
    stepRecipientSms: null,
    statusType: "002",
    stepType: "05",
    contractEndDate: null,
    displayStatus: undefined,
    createdDate: "2026-09-01T00:00:00.000Z",
};

const ERROR_TITLE = "계약서 정보를 불러오지 못했습니다";
const EMPTY_TEXT = "계약서 정보가 없습니다";

let queryClient: QueryClient;

function openContractsTab() {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={queryClient}>
            <ClientDetailPanel client={client} trailing={null} layout="desktop" />
        </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "계약서 정보" }));
}

function skeleton() {
    return document.querySelector('[data-component$="-contracts-skeleton-list"]');
}

describe("ClientDetailPanel contracts area: loading, failed and empty are different states", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getLinkConfirmations.mockReset();
        getLinkConfirmations.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
        onlineManager.setOnline(true);
    });

    it("shows the skeleton, not the empty state, while the contracts read is paused offline with no data", async () => {
        onlineManager.setOnline(false);
        openContractsTab();

        await waitFor(() =>
            expect(
                queryClient.getQueryState(["eformsign-docs", "client", client.id])?.fetchStatus,
            ).toBe("paused"),
        );
        expect(getDocuments).not.toHaveBeenCalled();
        expect(skeleton()).not.toBeNull();
        expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the skeleton while loading, and neither the error panel nor the empty state", async () => {
        getDocuments.mockReturnValue(new Promise(() => undefined));
        openContractsTab();

        await waitFor(() => expect(skeleton()).not.toBeNull());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
        expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    });

    it("shows the error panel with a retry button when the load failed and there is no data, and retry refetches", async () => {
        getDocuments.mockRejectedValue(new Error("boom"));
        openContractsTab();

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(ERROR_TITLE);
        expect(alert.getAttribute("data-component")).toMatch(/-contracts-error$/);
        expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
        expect(skeleton()).toBeNull();
        expect(getDocuments).toHaveBeenCalledTimes(1);

        // The refetch succeeds this time: the area recovers to the data.
        getDocuments.mockResolvedValue([contractDoc]);
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

        await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps showing cached contracts when a refetch fails, and says so with a retry notice", async () => {
        getDocuments.mockResolvedValue([contractDoc]);
        openContractsTab();
        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        getDocuments.mockRejectedValue(new Error("boom"));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: ["eformsign-docs", "client", client.id] });
        });

        await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(2));
        expect(queryClient.getQueryState(["eformsign-docs", "client", client.id])?.status).toBe("error");
        expect(screen.getAllByTestId("contract-card")).toHaveLength(1);
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        expect(alert.getAttribute("data-component")).toMatch(/-contracts-refresh-error$/);
        expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();

        // Retry refetches; once it succeeds the notice goes away and the data stays.
        getDocuments.mockResolvedValue([contractDoc]);
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
        expect(screen.getAllByTestId("contract-card")).toHaveLength(1);
    });

    it("shows the existing empty state, and no retry button, for a successful empty result", async () => {
        getDocuments.mockResolvedValue([]);
        openContractsTab();

        expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
        expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
    });
});

const PENDING_ERROR_TITLE = "연결 확인이 필요한 계약서를 불러오지 못했습니다";
const STALE_TEXT = "최신 정보를 불러오지 못했습니다";
const MANAGER_ONLY_TEXT = "지점 관리자만 연결을 확정할 수 있습니다";

function pendingEntry(overrides: Partial<EformsignLinkConfirmation> = {}): EformsignLinkConfirmation {
    return {
        documentId: "pending-1",
        documentName: "서비스 계약서",
        statusType: "002",
        statusDetail: "고객 서명",
        createdDate: "2026-09-01T00:00:00.000Z",
        document: { name: "박계약", phone: "01011112222", birthday: "1990-01-02" },
        client: { id: 1, name: "김고객", phone: "01011112222", birthday: "1991-03-04" },
        differences: ["name"],
        canConfirm: true,
        ...overrides,
    };
}

function pendingRegion(suffix: string) {
    return document.querySelector(`[data-component$="-contracts-link-confirmation-${suffix}"]`);
}

describe("ClientDetailPanel contracts area: contracts waiting for link confirmation (S3 / 계약-05)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getLinkConfirmations.mockReset();
        getLinkConfirmations.mockResolvedValue([]);
        getDocuments.mockResolvedValue([contractDoc]);
    });

    afterEach(() => {
        cleanup();
        onlineManager.setOnline(true);
    });

    it("lists each pending contract with the badge, the count and the differing items", async () => {
        getLinkConfirmations.mockResolvedValue([
            pendingEntry(),
            pendingEntry({ documentId: "pending-2", documentName: null, differences: ["name", "birthday"] }),
        ]);
        openContractsTab();

        expect(await screen.findByText("확인 필요 계약서 2건")).toBeInTheDocument();
        expect(getLinkConfirmations).toHaveBeenCalledWith(client.id);
        expect(screen.getAllByText("연결 확인 필요")).toHaveLength(2);
        expect(screen.getByText("서비스 계약서")).toBeInTheDocument();
        expect(screen.getByText("계약서")).toBeInTheDocument();
        expect(screen.getByText("이름이 다릅니다")).toBeInTheDocument();
        expect(screen.getByText("이름과 생년월일이 다릅니다")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "확인" })).toHaveLength(2);
        // The linked contract is still listed beneath.
        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));
    });

    it("names a birthday-only difference", async () => {
        getLinkConfirmations.mockResolvedValue([pendingEntry({ differences: ["birthday"] })]);
        openContractsTab();

        expect(await screen.findByText("생년월일이 다릅니다")).toBeInTheDocument();
        expect(screen.getByText("확인 필요 계약서 1건")).toBeInTheDocument();
    });

    it("opens the comparison dialog for that contract when 확인 is pressed", async () => {
        getLinkConfirmations.mockResolvedValue([pendingEntry()]);
        openContractsTab();

        fireEvent.click(await screen.findByRole("button", { name: "확인" }));

        expect(await screen.findByRole("heading", { name: "계약서 연결 확인" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "계약서: 박계약" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "취소" }));
        await waitFor(() =>
            expect(screen.queryByRole("heading", { name: "계약서 연결 확인" })).not.toBeInTheDocument(),
        );
    });

    it("shows no 확인 button and the manager-only line when the caller may not confirm", async () => {
        getLinkConfirmations.mockResolvedValue([pendingEntry({ canConfirm: false })]);
        openContractsTab();

        expect(await screen.findByText(MANAGER_ONLY_TEXT)).toBeInTheDocument();
        expect(screen.getByText("연결 확인 필요")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
    });

    it("shows the manager-only line only for the entries that cannot be confirmed", async () => {
        getLinkConfirmations.mockResolvedValue([
            pendingEntry(),
            pendingEntry({ documentId: "pending-2", canConfirm: false }),
        ]);
        openContractsTab();

        expect(await screen.findByText(MANAGER_ONLY_TEXT)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "확인" })).toHaveLength(1);
    });

    it("renders nothing extra while the pending list is loading", async () => {
        getLinkConfirmations.mockReturnValue(new Promise(() => undefined));
        openContractsTab();

        await waitFor(() => expect(getLinkConfirmations).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));
        expect(pendingRegion("list")).toBeNull();
        expect(pendingRegion("error")).toBeNull();
        expect(screen.queryByText(/확인 필요 계약서/)).not.toBeInTheDocument();
        expect(screen.queryByText("0건")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("renders nothing extra while the pending list is paused with no data", async () => {
        onlineManager.setOnline(false);
        openContractsTab();

        await waitFor(() =>
            expect(
                queryClient.getQueryState(["eformsign-docs", "link-confirmations", client.id])?.fetchStatus,
            ).toBe("paused"),
        );
        expect(getLinkConfirmations).not.toHaveBeenCalled();
        expect(pendingRegion("list")).toBeNull();
        expect(pendingRegion("error")).toBeNull();
        expect(screen.queryByText(/확인 필요 계약서/)).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("renders nothing extra for a loaded empty list, and keeps the linked contracts", async () => {
        openContractsTab();

        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));
        await waitFor(() => expect(getLinkConfirmations).toHaveBeenCalledTimes(1));
        expect(pendingRegion("list")).toBeNull();
        expect(screen.queryByText(/확인 필요 계약서/)).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows an alert with retry when the pending list failed with no data, and retry refetches", async () => {
        getLinkConfirmations.mockRejectedValue(new Error("boom"));
        openContractsTab();

        await waitFor(() => expect(pendingRegion("error")).not.toBeNull());
        const alert = pendingRegion("error") as HTMLElement;
        expect(alert).toHaveAttribute("role", "alert");
        expect(alert).toHaveTextContent(PENDING_ERROR_TITLE);
        expect(screen.queryByText(/확인 필요 계약서/)).not.toBeInTheDocument();
        expect(getLinkConfirmations).toHaveBeenCalledTimes(1);

        getLinkConfirmations.mockResolvedValue([pendingEntry()]);
        fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));

        await waitFor(() => expect(getLinkConfirmations).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("확인 필요 계약서 1건")).toBeInTheDocument();
        expect(pendingRegion("error")).toBeNull();
    });

    it("keeps the pending entries and adds a stale notice when a refetch fails", async () => {
        getLinkConfirmations.mockResolvedValue([pendingEntry()]);
        openContractsTab();
        expect(await screen.findByText("확인 필요 계약서 1건")).toBeInTheDocument();

        getLinkConfirmations.mockRejectedValue(new Error("boom"));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: ["eformsign-docs", "link-confirmations", client.id] });
        });

        expect(queryClient.getQueryState(["eformsign-docs", "link-confirmations", client.id])?.status).toBe("error");
        await waitFor(() => expect(pendingRegion("refresh-error")).not.toBeNull());
        const notice = pendingRegion("refresh-error") as HTMLElement;
        expect(notice).toHaveTextContent(STALE_TEXT);
        expect(screen.getByText("확인 필요 계약서 1건")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "확인" })).toBeInTheDocument();

        getLinkConfirmations.mockResolvedValue([pendingEntry()]);
        fireEvent.click(within(notice).getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(pendingRegion("refresh-error")).toBeNull());
        expect(screen.getByText("확인 필요 계약서 1건")).toBeInTheDocument();
    });

    it("does not claim there are no contracts while a pending entry is listed above an empty linked list", async () => {
        getDocuments.mockResolvedValue([]);
        getLinkConfirmations.mockResolvedValue([pendingEntry()]);
        openContractsTab();

        expect(await screen.findByText("확인 필요 계약서 1건")).toBeInTheDocument();
        await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    });

    it("keeps the existing empty text when there is no pending entry and no linked contract", async () => {
        getDocuments.mockResolvedValue([]);
        openContractsTab();

        expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
        expect(screen.queryByText(/확인 필요 계약서/)).not.toBeInTheDocument();
    });

    it("keeps the existing empty text when the pending list failed to load", async () => {
        getDocuments.mockResolvedValue([]);
        getLinkConfirmations.mockRejectedValue(new Error("boom"));
        openContractsTab();

        expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
        await waitFor(() => expect(pendingRegion("error")).not.toBeNull());
    });
});

describe("ClientDetailPanel contracts area: voided contract (계약 파기, BJJ-439)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getLinkConfirmations.mockReset();
        getLinkConfirmations.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
    });

    it("shows 파기됨 with the neutral pending badge status, whatever eformsign code the document carries", async () => {
        getDocuments.mockResolvedValue([{ ...contractDoc, statusType: "003", displayStatus: "voided" }]);
        openContractsTab();

        const badge = await screen.findByTestId("status-badge");
        expect(badge).toHaveTextContent("파기됨");
        expect(badge).toHaveAttribute("data-status", "pending");
    });

    it("keeps the badge of a live document unchanged (control)", async () => {
        getDocuments.mockResolvedValue([{ ...contractDoc, statusType: "003", displayStatus: "completed" }]);
        openContractsTab();

        const badge = await screen.findByTestId("status-badge");
        expect(badge).toHaveTextContent("계약 완료");
        expect(badge).toHaveAttribute("data-status", "completed");
    });
});

describe("ClientDetailPanel contracts area: 계약 파기 action (BJJ-439 D9)", () => {
    const VOID_TITLE = "계약을 파기할까요?";
    const VOID_DESCRIPTION = "파기하면 되돌릴 수 없습니다. 서명 전 계약서는 서명 링크도 함께 취소됩니다.";

    const liveDoc = { ...contractDoc, statusType: "002", displayStatus: "pending" };

    const withStatus = (code: string, displayStatus: string, extra: Record<string, unknown> = {}) => ({
        ...contractDoc,
        statusType: code,
        displayStatus,
        ...extra,
    });

    function axiosFailure(status: number | undefined): AxiosError {
        return new AxiosError(
            "failed",
            status === undefined ? "ERR_NETWORK" : "ERR_BAD_RESPONSE",
            undefined,
            undefined,
            status === undefined
                ? undefined
                : {
                      status,
                      statusText: String(status),
                      headers: {},
                      config: { headers: new AxiosHeaders() },
                      data: {},
                  },
        );
    }

    async function openVoidModal() {
        fireEvent.click(await screen.findByRole("button", { name: "계약 파기" }));
        return screen.findByRole("dialog");
    }

    function spyOnInvalidation() {
        return jest.spyOn(queryClient, "invalidateQueries");
    }

    function expectFullInvalidationSet(spy: jest.SpyInstance) {
        const keys = spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
        expect(keys).toEqual(
            expect.arrayContaining([
                ["eformsign-docs", "client", client.id],
                clientKeys.all,
                ["eformsign-documents"],
                dashboardQueryKeys.overviewAll(),
            ]),
        );
    }

    function voidRow(): HTMLElement {
        return within(screen.getByTestId("contract-card")).getByText("파기", { selector: "span" })
            .parentElement as HTMLElement;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mockToast.mockReset();
        getLinkConfirmations.mockReset();
        getLinkConfirmations.mockResolvedValue([]);
        voidContractDocument.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it("offers 계약 파기 at a quarter width and 문서 보기 at three quarters on a voidable card", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        openContractsTab();

        const voidButton = await screen.findByRole("button", { name: "계약 파기" });
        const previewButton = screen.getByRole("button", { name: "문서 보기" });
        expect(voidButton).toHaveClass("w-1/4");
        expect(previewButton).toHaveClass("w-3/4");
        expect(previewButton).not.toHaveClass("w-full");
        expect(within(screen.getByTestId("contract-card")).queryByText("파기", { selector: "span" })).toBeNull();
    });

    it.each([
        ["서명 대기", "pending", "002"],
        ["계약 완료", "completed", "003"],
        ["철회 요청됨", "revoke_requested", "040"],
        ["반려됨", "rejected_by_reviewer", "071"],
    ])("offers 계약 파기 on a %s card", async (_label, displayStatus, code) => {
        getDocuments.mockResolvedValue([withStatus(code, displayStatus)]);
        openContractsTab();

        expect(await screen.findByRole("button", { name: "계약 파기" })).toBeInTheDocument();
    });

    it.each([
        ["voided", "003", "voided", { voidedAt: "2026-10-13T01:02:03.000Z", voidedByName: "박지점" }],
        ["철회됨", "042", "revoked", {}],
        ["기간 만료", "002", "expired", {}],
    ])("does not offer 계약 파기 on a %s card, only a full-width 문서 보기", async (_label, code, displayStatus, extra) => {
        getDocuments.mockResolvedValue([withStatus(code, displayStatus, extra)]);
        openContractsTab();

        const previewButton = await screen.findByRole("button", { name: "문서 보기" });
        expect(screen.queryByRole("button", { name: "계약 파기" })).not.toBeInTheDocument();
        expect(previewButton).toHaveClass("w-full");
        expect(previewButton).not.toHaveClass("w-3/4");
    });

    it("does not offer 계약 파기 on a card with a voidedAt even if the displayStatus is stale", async () => {
        getDocuments.mockResolvedValue([
            withStatus("002", "pending", { voidedAt: "2026-10-13T01:02:03.000Z", voidedByName: null }),
        ]);
        openContractsTab();

        await screen.findByRole("button", { name: "문서 보기" });
        expect(screen.queryByRole("button", { name: "계약 파기" })).not.toBeInTheDocument();
    });

    it("shows a 파기 row with time and name on a voided card", async () => {
        getDocuments.mockResolvedValue([
            withStatus("003", "voided", { voidedAt: "2026-10-13T01:02:03.000Z", voidedByName: "박지점" }),
        ]);
        openContractsTab();

        const badge = await screen.findByTestId("status-badge");
        expect(badge).toHaveTextContent("파기됨");
        expect(voidRow()).toHaveTextContent(/2026.*10.*13.*· 박지점/);
    });

    it("shows 알 수 없음 as the name when voidedByName is null", async () => {
        getDocuments.mockResolvedValue([
            withStatus("003", "voided", { voidedAt: "2026-10-13T01:02:03.000Z", voidedByName: null }),
        ]);
        openContractsTab();

        await screen.findByTestId("status-badge");
        expect(voidRow()).toHaveTextContent("· 알 수 없음");
    });

    it("opens the preview with the adapted document and the client name from 문서 보기", async () => {
        getDocuments.mockResolvedValue([
            {
                ...liveDoc,
                documentName: "산후도우미 계약서",
                documentNumber: "BJ-0001",
                templateName: "서비스 계약서",
            },
        ]);
        openContractsTab();

        fireEvent.click(await screen.findByRole("button", { name: "문서 보기" }));

        expect(await screen.findByTestId("preview-modal")).toBeInTheDocument();
        expect(screen.getByTestId("preview-id")).toHaveTextContent("doc-1");
        expect(screen.getByTestId("preview-name")).toHaveTextContent("산후도우미 계약서");
        expect(screen.getByTestId("preview-number")).toHaveTextContent("BJ-0001");
        expect(screen.getByTestId("preview-template")).toHaveTextContent("서비스 계약서");
        expect(screen.getByTestId("preview-created")).toHaveTextContent(String(Date.parse("2026-09-01T00:00:00.000Z")));
        expect(screen.getByTestId("preview-customer")).toHaveTextContent("김고객");
    });

    it("opens a confirm modal with the shared title and a visible description, and sends nothing yet", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        openContractsTab();

        const dialog = await openVoidModal();

        expect(within(dialog).getByText(VOID_TITLE)).toBeInTheDocument();
        const description = within(dialog).getByText(VOID_DESCRIPTION);
        expect(description).not.toHaveClass("sr-only");
        expect(within(dialog).getByRole("button", { name: "취소" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "파기" })).toBeInTheDocument();
        expect(voidContractDocument).not.toHaveBeenCalled();
    });

    it("sends no request when the user cancels", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        openContractsTab();
        const dialog = await openVoidModal();

        fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(voidContractDocument).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });

    it("voids the document, disables the confirm button while pending, then toasts, closes and invalidates", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        let resolveVoid: (value: unknown) => void = () => undefined;
        voidContractDocument.mockReturnValue(new Promise((resolve) => { resolveVoid = resolve; }));
        openContractsTab();
        const dialog = await openVoidModal();
        // Spy only after the panel's own mount-time refreshes: what is counted here is the void's.
        const invalidate = spyOnInvalidation();

        fireEvent.click(within(dialog).getByRole("button", { name: "파기" }));

        await waitFor(() => expect(voidContractDocument).toHaveBeenCalledWith("doc-1"));
        const pending = await within(dialog).findByRole("button", { name: "파기 중" });
        expect(pending).toBeDisabled();
        // No optimistic update: nothing is announced or refreshed until the server answers.
        expect(mockToast).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();

        resolveVoid({
            documentId: "doc-1",
            voidedAt: "2026-10-13T01:02:03.000Z",
            voidedByName: "박지점",
            displayStatus: "voided",
        });

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(mockToast).toHaveBeenCalledWith({ variant: "success", description: "계약을 파기했습니다." });
        expectFullInvalidationSet(invalidate);
    });

    it("answers a 409 with the conflict toast, closes the modal and refreshes the stale card", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        voidContractDocument.mockRejectedValue(axiosFailure(409));
        openContractsTab();
        const dialog = await openVoidModal();
        const invalidate = spyOnInvalidation();

        fireEvent.click(within(dialog).getByRole("button", { name: "파기" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(mockToast).toHaveBeenCalledWith({
            variant: "destructive",
            description: "이미 파기되었거나 파기할 수 없는 계약서입니다.",
        });
        expectFullInvalidationSet(invalidate);
    });

    it.each([
        ["a 500", 500],
        ["a network error with no response", undefined],
        ["a 503", 503],
    ])("keeps the modal open after %s, toasts the failure and still invalidates", async (_label, status) => {
        getDocuments.mockResolvedValue([liveDoc]);
        voidContractDocument.mockRejectedValue(axiosFailure(status));
        openContractsTab();
        const dialog = await openVoidModal();
        const invalidate = spyOnInvalidation();

        fireEvent.click(within(dialog).getByRole("button", { name: "파기" }));

        await waitFor(() =>
            expect(mockToast).toHaveBeenCalledWith({
                variant: "destructive",
                description: "계약을 파기하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            }),
        );
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        // The confirm button is usable again so the user can retry or cancel.
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: "파기" })).toBeEnabled();
        expectFullInvalidationSet(invalidate);
    });

    it("lets the user retry after a failure", async () => {
        getDocuments.mockResolvedValue([liveDoc]);
        voidContractDocument.mockRejectedValueOnce(axiosFailure(500));
        voidContractDocument.mockResolvedValueOnce({
            documentId: "doc-1",
            voidedAt: "2026-10-13T01:02:03.000Z",
            voidedByName: null,
            displayStatus: "voided",
        });
        openContractsTab();
        const dialog = await openVoidModal();

        fireEvent.click(within(dialog).getByRole("button", { name: "파기" }));
        await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "파기" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(voidContractDocument).toHaveBeenCalledTimes(2);
        expect(mockToast).toHaveBeenLastCalledWith({ variant: "success", description: "계약을 파기했습니다." });
    });
});
