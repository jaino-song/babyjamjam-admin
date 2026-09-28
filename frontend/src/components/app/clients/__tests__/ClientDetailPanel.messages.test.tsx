import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { ClientDetailPanel } from "../ClientDetailPanel";
import type { Client } from "@/lib/client/types";
import type {
    ClientUpcomingMessageTriggerJob,
    MessageLogRecord,
} from "@/features/message-triggers/types";
import { eformsignApi } from "@/services/api";

const mockUseMessageHistory = jest.fn();
const mockUseClientUpcomingMessageTriggerJobs = jest.fn();

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useApproveScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useRejectScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
    useMessageHistory: (...args: unknown[]) => mockUseMessageHistory(...args),
    useClientUpcomingMessageTriggerJobs: (...args: unknown[]) => mockUseClientUpcomingMessageTriggerJobs(...args),
}));

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

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn().mockResolvedValue([]),
    },
}));

jest.mock("@/components/app/messages/MessageHistoryDetailPanel", () => ({
    getMessageHistoryTimestamp: (record: MessageLogRecord) => record.lastAttemptAt ?? record.updatedAt,
    formatMessageHistoryDate: (value: string) => `날짜 ${value}`,
    normalizeMessageHistoryRecord: (record: MessageLogRecord, options: { recipientNameFallback?: string; recipientListLabelFallback?: string }) => ({
        id: record.id,
        title: record.ruleName ?? record.templateKey,
        templateLabel: record.templateKey,
        recipientName: record.recipientName ?? options.recipientNameFallback ?? "",
        recipientPhone: record.recipientPhone ?? "",
        recipientListLabel: record.clientName ?? options.recipientListLabelFallback ?? "",
        channelLabel: "메시지",
        sentAt: record.lastAttemptAt ?? record.updatedAt,
        status: record.status,
        messagePreview: record.messageBody,
        recipientType: record.recipientType,
        icon: () => <span aria-hidden="true">아이콘</span>,
    }),
    MessageHistoryDetailPanel: ({ selectedRecord }: { selectedRecord: { messagePreview: string } | null }) => selectedRecord ? (
        <div data-testid="message-history-detail-body">{selectedRecord.messagePreview}</div>
    ) : null,
}));

jest.mock("@/components/app/clients/ClientServiceRecordsTab", () => ({
    ClientServiceRecordsTab: () => null,
}));

jest.mock("@/components/app/v3", () => ({
    AnimatedSlotList: ({
        items,
        isLoading,
        itemDataComponent,
        render,
        onSlotClick,
    }: {
        items?: readonly unknown[] | null;
        isLoading: boolean;
        itemDataComponent?: string;
        render: (args: { item: unknown | null; index: number; isLoading: boolean }) => ReactNode;
        onSlotClick?: (item: unknown, index: number) => void;
    }) => (
        <div data-component={itemDataComponent}>
            {isLoading ? null : (items ?? []).map((item, index) => (
                <div
                    key={String((item as { id?: string | number }).id ?? index)}
                    data-component={itemDataComponent}
                    role={onSlotClick ? "button" : undefined}
                    tabIndex={onSlotClick ? 0 : undefined}
                    onClick={() => onSlotClick?.(item, index)}
                >
                    {render({ item, index, isLoading: false })}
                </div>
            ))}
        </div>
    ),
    AnimatedSlotListItemContent: ({
        title,
        subtitle,
        meta,
        status,
        "data-component": dataComponent,
    }: {
        title: ReactNode;
        subtitle?: ReactNode;
        meta?: ReactNode;
        status?: ReactNode;
        "data-component"?: string;
    }) => (
        <article data-component={dataComponent}>
            <h4>{title}</h4>
            {subtitle ? <div data-slot="subtitle">{subtitle}</div> : null}
            {meta ? <div data-slot="meta">{meta}</div> : null}
            {status ? <div data-slot="status">{status}</div> : null}
        </article>
    ),
    DetailEmptyState: ({ message }: { message: string }) => <p>{message}</p>,
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
    InfoCard: ({ children }: { children: ReactNode }) => <section data-source-component="InfoCard">{children}</section>,
    InfoRow: ({ label, value }: { label: string; value: ReactNode }) => <div><span>{label}</span><span>{value}</span></div>,
    StatusBadge: () => null,
}));

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

const historyRecord: MessageLogRecord = {
    id: 10,
    provider: "sms",
    templateKey: "SURVEY",
    triggerJobId: "job-10",
    receiver: "01011112222",
    clientId: client.id,
    recipientPhone: "01011112222",
    messageBody: "본문은 선택한 상세 화면에서만 보여야 하는 긴 메시지 본문입니다.",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-09-28T06:00:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-09-28T05:59:00.000Z",
    updatedAt: "2026-09-28T06:00:00.000Z",
    ruleId: "rule-10",
    ruleName: "모니터링 설문",
    eventType: "SERVICE_END",
    offsetType: "IMMEDIATE",
    offsetDays: 0,
    scheduledFor: null,
    recipientType: "CLIENT",
    recipientName: "김고객",
    clientName: "김고객",
    employeeName: null,
};

const upcomingJob: ClientUpcomingMessageTriggerJob = {
    id: "upcoming-1",
    ruleName: "서비스 종료 안내",
    templateKey: "SERVICE_END_NOTICE",
    scheduledFor: "2026-09-29T06:00:00.000Z",
    nextAttemptAt: null,
    effectiveDueAt: "2026-09-29T06:00:00.000Z",
    status: "pending",
    recipientType: "CLIENT",
    recipientName: "김고객",
};

function renderPanel(layout: "desktop" | "mobile" = "desktop") {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <ClientDetailPanel client={client} trailing={null} layout={layout} />
        </QueryClientProvider>,
    );
}

describe("ClientDetailPanel messages tab", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (eformsignApi.getDocumentsByClientId as jest.Mock).mockResolvedValue([]);
        mockUseMessageHistory.mockReturnValue({ data: [historyRecord], isError: false, isLoading: false });
        mockUseClientUpcomingMessageTriggerJobs.mockReturnValue({
            items: [upcomingJob],
            isError: false,
            isLoading: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: jest.fn(),
            refetch: jest.fn(),
        });
    });

    function openMessagesTab(layout: "desktop" | "mobile" = "desktop") {
        renderPanel(layout);
        fireEvent.click(screen.getByRole("button", { name: "알림 발송" }));
    }

    it("renders upcoming and history as direct list zones without InfoCard wrappers", () => {
        openMessagesTab();

        expect(screen.getByText("예정된 자동 메시지")).toBeInTheDocument();
        expect(screen.getByText("발송 기록")).toBeInTheDocument();
        expect(screen.getAllByText("서비스 종료 안내").length).toBeGreaterThan(0);
        expect(screen.getAllByText("고객: 김고객").length).toBeGreaterThan(0);
        expect(screen.getByText("모니터링 설문")).toBeInTheDocument();
        expect(screen.getByText("발송 성공")).toBeInTheDocument();
        expect(screen.getByText("날짜 2026-09-28T06:00:00.000Z")).toBeInTheDocument();

        const zones = document.querySelectorAll('[data-slot="message-zone"]');
        expect(zones).toHaveLength(2);
        zones.forEach((zone) => {
            expect(zone.getAttribute("data-source-component")).not.toBe("InfoCard");
            expect(zone.querySelector('[data-source-component="InfoCard"]')).toBeNull();
        });
    });

    it("keeps the body out of list rows while preserving the selected detail view", () => {
        openMessagesTab();

        expect(screen.queryByText(historyRecord.messageBody)).not.toBeInTheDocument();
        const historyRow = screen.getByRole("heading", { name: "모니터링 설문" }).closest('[role="button"]');
        expect(historyRow).toBeInTheDocument();
        fireEvent.click(historyRow!);
        expect(screen.getByTestId("message-history-detail-body")).toHaveTextContent(historyRecord.messageBody);
    });

    it("constrains the messages track for both desktop and mobile presentations", () => {
        openMessagesTab("desktop");
        const desktopSections = document.querySelector('[data-component$="_content_messages_sections"]');
        expect(desktopSections).toBeInTheDocument();
        expect(desktopSections).toHaveClass("min-w-0", "w-full", "max-w-full");

        const desktopTrack = document.querySelector('[data-component$="-message-slide-track"]');
        expect(desktopTrack).toHaveClass("min-w-0", "w-full", "max-w-full");

        cleanup();
        openMessagesTab("mobile");
        const mobilePresentation = document.querySelector('[data-slot="client-detail-presentation"]');
        expect(mobilePresentation).toHaveClass("min-w-0", "w-full", "max-w-full");
    });
});
