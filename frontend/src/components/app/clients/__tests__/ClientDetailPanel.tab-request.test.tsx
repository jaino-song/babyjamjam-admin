import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ClientDetailPanel } from "../ClientDetailPanel";
import type { Client } from "@/lib/client/types";

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useClient: () => ({}),
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
        useRetryMessageHistory: () => ({ mutateAsync: jest.fn(), isPending: false }),
        useResendMessageTriggerJob: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
        getDocumentsByClientId: jest.fn().mockResolvedValue([]),
        getLinkConfirmations: jest.fn().mockResolvedValue([]),
        adoptDocument: jest.fn(),
        voidContractDocument: jest.fn(),
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
    ClientServiceRecordsTab: () => <div>기록지 탭 본문</div>,
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
        <div data-testid="active-panel" data-tab={activeTab}>{panels.find((panel) => panel.key === activeTab)?.children}</div>
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


const client = { id: 1, name: "QA-고객" } as Client;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => { cleanup(); queryClient.clear(); });
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

it("starts on basic without a request and ignores a request for another client", () => {
  const { rerender } = render(<ClientDetailPanel client={client} trailing={null} />, { wrapper: Wrapper });
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "basic");
  rerender(<ClientDetailPanel client={client} trailing={null} tabRequest={{ clientId: 2, tab: "service-records", nonce: 1 }} />);
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "basic");
});

it("applies requests on mount and new nonce, lets the user switch tabs between requests", () => {
  const request = { clientId: 1, tab: "service-records" as const, nonce: 1 };
  const { rerender } = render(<ClientDetailPanel client={client} trailing={null} tabRequest={request} />, { wrapper: Wrapper });
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "service-records");
  expect(screen.getByText("기록지 탭 본문")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "기본 정보" }));
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "basic");
  rerender(<ClientDetailPanel client={client} trailing={null} tabRequest={request} />);
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "basic");
  rerender(<ClientDetailPanel client={client} trailing={null} tabRequest={{ ...request, nonce: 2 }} />);
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "service-records");
  rerender(<ClientDetailPanel client={{ ...client, id: 2 }} trailing={null} />);
  expect(screen.getByTestId("active-panel")).toHaveAttribute("data-tab", "basic");
});
