import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { ClientDetailPanel } from "../ClientDetailPanel";
import type { Client } from "@/lib/client/types";
import { eformsignApi } from "@/services/api";

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useApproveScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useRejectScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
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

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn(),
    },
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
    StatusBadge: () => null,
}));

const getDocuments = eformsignApi.getDocumentsByClientId as jest.Mock;

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
    });

    afterEach(() => {
        cleanup();
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

    it("keeps showing cached contracts when a refetch fails, with no error panel", async () => {
        getDocuments.mockResolvedValue([contractDoc]);
        openContractsTab();
        await waitFor(() => expect(screen.getAllByTestId("contract-card")).toHaveLength(1));

        getDocuments.mockRejectedValue(new Error("boom"));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: ["eformsign-docs", "client", client.id] });
        });

        await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(2));
        expect(queryClient.getQueryState(["eformsign-docs", "client", client.id])?.status).toBe("error");
        expect(screen.getAllByTestId("contract-card")).toHaveLength(1);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
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
