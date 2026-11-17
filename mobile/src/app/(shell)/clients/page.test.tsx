import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Client } from "@/lib/client/types";
import { fetchClient, useClient, useDeleteClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useServiceRecordMissingClients } from "@/features/clients/hooks/use-clients";
import ClientsPage from "./page";
import { api } from "@/lib/api/client";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockClientId: string | null = "1";
const mockSearchParams = {
  get: (key: string) => (key === "id" ? mockClientId : null),
};

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/useClients", () => ({
  clientQueryKeys: {
    all: ["clients"],
    lists: () => ["clients", "list"],
    details: () => ["clients", "detail"],
    detail: (id: number) => ["clients", "detail", id],
  },
  fetchClient: jest.fn(),
  useClient: jest.fn(),
  useDeleteClient: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

jest.mock("@/features/clients/hooks/use-clients", () => ({
  useServiceRecordMissingClients: jest.fn(),
}));

jest.mock("@/hooks/useInfiniteClients", () => ({
  useInfiniteClients: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

jest.mock("@/hooks/useClientMessageHistory", () => ({
  useClientMessageHistory: () => ({
    notificationLogs: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("@/stores/form-store", () => ({
  useFormStore: (selector: (state: { prefillFromContract: jest.Mock }) => unknown) =>
    selector({ prefillFromContract: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 10,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: jest.fn(),
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({
    beforeFilters,
    children,
    count,
    filters,
    onFilterChange,
    title,
  }: {
    beforeFilters?: ReactNode;
    children: ReactNode;
    count?: ReactNode;
    filters: Array<{ label: string; count: ReactNode; skeleton?: boolean }>;
    onFilterChange?: (label: string) => void;
    title?: string;
  }) => (
    <div>
      {title ? <div data-testid="list-card-header-count">{title} {count}</div> : null}
      {beforeFilters}
      <div data-testid="list-card-filters">
        {filters.map((filter) => (
          <button key={filter.label} type="button" onClick={() => onFilterChange?.(filter.label)}>
            {filter.label} {filter.skeleton ? <span aria-label="개수 로딩 중">로딩 중</span> : filter.count}
          </button>
        ))}
      </div>
      {children}
    </div>
  ),
  ListCountSkeleton: () => <span>로딩 중</span>,
  ListItemRow: ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{name}</button>
  ),
  ListLoadMoreSentinel: () => null,
  ListRowBadges: () => null,
  ListRowsSkeleton: () => <div>로딩 중</div>,
  MobileSectionNav: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({
    detail,
    list,
  }: {
    detail: ReactNode;
    list: ReactNode;
  }) => <div>{list}{detail}</div>,
  MobileSearchBar: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label="고객 검색"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => null,
}));

jest.mock("@/components/app/clients/client-detail", () => ({
  GROUPS: [{
    key: "active",
    title: "진행 중",
    counter: "명",
    badgeTone: "primary",
    match: () => true,
  }],
  groupForClient: () => ({
    key: "active",
    title: "진행 중",
    counter: "명",
    badgeTone: "primary",
    match: () => true,
  }),
  ClientDetailContent: ({
    client,
    activeTab,
    onDelete,
  }: {
    client: Client;
    activeTab: string;
    onDelete: (id: number) => void;
  }) => (
    <div data-testid={`client-detail-${client.id}`} data-active-tab={activeTab}>
      <span>{client.name}</span>
      <button type="button" aria-label={`delete client ${client.id}`} onClick={() => onDelete(client.id)}>
        삭제
      </button>
    </div>
  ),
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
  MobileTwoButtonModal: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => void | Promise<void>;
  }) => open ? (
    <button type="button" aria-label="confirm client delete" onClick={() => void onConfirm()}>
      확인
    </button>
  ) : null,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
}));

const mockedFetchClient = jest.mocked(fetchClient);
const mockedUseClient = jest.mocked(useClient);
const mockedUseDeleteClient = jest.mocked(useDeleteClient);
const mockedUseInfiniteClients = jest.mocked(useInfiniteClients);
const mockedUseServiceRecordMissingClients = jest.mocked(useServiceRecordMissingClients);

beforeEach(() => {
  mockedUseServiceRecordMissingClients.mockReturnValue({
    data: { count: 0, items: [] }, isLoading: false, isError: false,
    isFetching: false, refetch: jest.fn(),
  } as unknown as ReturnType<typeof useServiceRecordMissingClients>);
});

function makeClient(id: number): Client {
  return {
    id,
    name: `고객 ${id}`,
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: null,
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
    serviceStatus: "active",
    bookingConfirmedAt: null,
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientsPage />
    </QueryClientProvider>,
  );
}

describe("ClientsPage URL-selected detail identity", () => {
  beforeEach(() => {
    mockClientId = "1";
    jest.clearAllMocks();
    mockedUseClient.mockReturnValue({ data: undefined } as ReturnType<typeof useClient>);
    mockedUseInfiniteClients.mockReturnValue({
      allClients: [makeClient(1), makeClient(2)],
      allFilteredClients: [makeClient(1), makeClient(2)],
      total: 2,
      isLoading: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useInfiniteClients>);
    mockedUseDeleteClient.mockReturnValue({
      isPending: false,
      mutateAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useDeleteClient>);
  });

  it("does not promote the initial URL client over a later URL identity", async () => {
    const requests = new Map<number, { resolve: (client: Client) => void }>();
    mockedFetchClient.mockImplementation((id) => new Promise<Client>((resolve) => {
      requests.set(id, { resolve });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderPage(queryClient);

    await waitFor(() => expect(requests.has(1)).toBe(true));
    await act(async () => {
      requests.get(1)?.resolve(makeClient(1));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("client-detail-1")).toBeInTheDocument());

    mockClientId = "2";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(requests.has(2)).toBe(true));
    expect(screen.queryByRole("button", { name: "delete client 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "고객 정보 새로고침 중" })).toBeInTheDocument();

    await act(async () => {
      requests.get(2)?.resolve(makeClient(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("client-detail-2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "delete client 2" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm client delete" }));
    await waitFor(() => expect(mockedUseDeleteClient().mutateAsync).toHaveBeenCalledWith(2));
  });

  it("ignores a late response for the previous URL client", async () => {
    const requests = new Map<number, { resolve: (client: Client) => void }>();
    mockedFetchClient.mockImplementation((id) => new Promise<Client>((resolve) => {
      requests.set(id, { resolve });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderPage(queryClient);

    await waitFor(() => expect(requests.has(1)).toBe(true));
    mockClientId = "2";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(requests.has(2)).toBe(true));
    await waitFor(() => expect(screen.getByRole("status", { name: "고객 정보 새로고침 중" })).toBeInTheDocument());
    await act(async () => {
      requests.get(1)?.resolve(makeClient(1));
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "delete client 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "고객 정보 새로고침 중" })).toBeInTheDocument();

    await act(async () => {
      requests.get(2)?.resolve(makeClient(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("client-detail-2")).toBeInTheDocument());
  });

  it("uses the filtered count for the header and 전체 chip while searching", async () => {
    mockClientId = null;
    const clients = [makeClient(1), makeClient(2), makeClient(3)];
    mockedUseInfiniteClients.mockImplementation(({ search } = {}) => ({
      allClients: clients,
      allFilteredClients: search?.trim() ? clients.slice(0, 1) : clients,
      total: clients.length,
      isLoading: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useInfiniteClients>));

    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

    expect(screen.getByTestId("list-card-header-count")).toHaveTextContent("고객 3명");
    expect(screen.getByRole("button", { name: "전체 3" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "고객 검색" }), {
      target: { value: "고객 1" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("list-card-header-count")).toHaveTextContent("고객 1명");
      expect(screen.getByRole("button", { name: "전체 1" })).toBeInTheDocument();
    });
  });
});

describe("ClientsPage list load states", () => {
  const refetch = jest.fn();
  function setList(rows: Client[], isError = false, isFetching = false, isLoading = false) {
    mockedUseInfiniteClients.mockReturnValue({
      allClients: rows, allFilteredClients: rows, total: rows.length,
      isLoading, isError, isFetching, refetch,
    } as unknown as ReturnType<typeof useInfiniteClients>);
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockClientId = null;
    mockedUseClient.mockReturnValue({ data: undefined } as ReturnType<typeof useClient>);
    mockedUseDeleteClient.mockReturnValue({ isPending: false, mutateAsync: jest.fn() } as unknown as ReturnType<typeof useDeleteClient>);
  });

  it("retries a failed first load without claiming zero clients, then recovers", () => {
    setList([], true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderPage(queryClient);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.getByText("불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("등록된 고객이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByTestId("list-card-header-count")).not.toHaveTextContent("0명");
    const pills = within(screen.getByTestId("list-card-filters")).getAllByRole("button");
    expect(pills).toHaveLength(4);
    for (const pill of pills) {
      expect(pill).not.toHaveTextContent("0");
      expect(pill).toBeEnabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    setList([makeClient(9)]);
    view.rerender(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "고객 9" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows empty text only for a successful empty load", () => {
    setList([]);
    renderPage(new QueryClient());
    expect(screen.getByText("등록된 고객이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("list-card-header-count")).toHaveTextContent("0명");
    expect(screen.getByRole("button", { name: "전체 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계약서 필요 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "진행 중 0" })).toBeInTheDocument();
  });

  it("keeps cached rows with a quiet stale notice above them", () => {
    setList([makeClient(9)], true);
    renderPage(new QueryClient());
    const notice = screen.getByRole("status");
    const row = screen.getByRole("button", { name: "고객 9" });
    expect(notice).toHaveAttribute("data-component", "mobile_clients_detail-sheet_stack_list-page_content_list-card_body_cached-error");
    expect(notice).toHaveTextContent("새로 불러오지 못해 최근에 확인된 목록을 표시하고 있어요");
    expect(notice.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("list-card-header-count")).toHaveTextContent("1명");
    expect(screen.getByRole("button", { name: "전체 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계약서 필요 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "진행 중 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("keeps cached rows and no retry button while fetching", () => {
    setList([makeClient(9)], true, true);
    renderPage(new QueryClient());
    expect(screen.getByRole("button", { name: "고객 9" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("keeps the existing loading state before the first result", () => {
    setList([], false, true, true);
    renderPage(new QueryClient());
    expect(screen.getAllByText("로딩 중").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("등록된 고객이 없습니다.")).not.toBeInTheDocument();
  });
});


describe("ClientsPage service-record-missing filter", () => {
  const refetchMissing = jest.fn();
  const clients = [makeClient(3), makeClient(1), makeClient(2)];
  const missingData = {
    count: 3,
    items: [2, 3, 99].map((clientId) => ({
      clientId, clientName: `고객 ${clientId}`, primaryEmployeeName: "제공인력",
      unwrittenThroughSessionIndex: 4,
    })),
  };
  function setMissing({ data, isLoading = false, isError = false }: {
    data?: typeof missingData; isLoading?: boolean; isError?: boolean;
  }) {
    mockedUseServiceRecordMissingClients.mockReturnValue({
      data, isLoading, isError, isFetching: false, refetch: refetchMissing,
    } as unknown as ReturnType<typeof useServiceRecordMissingClients>);
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockClientId = null;
    mockedUseClient.mockReturnValue({ data: undefined } as ReturnType<typeof useClient>);
    mockedUseDeleteClient.mockReturnValue({ isPending: false, mutateAsync: jest.fn() } as unknown as ReturnType<typeof useDeleteClient>);
    mockedFetchClient.mockImplementation(async (id) => makeClient(id));
    mockedUseInfiniteClients.mockImplementation(({ search, searchFn } = {}) => ({
      allClients: clients,
      allFilteredClients: search?.trim() && searchFn ? clients.filter((client) => searchFn(client, search)) : clients,
      total: clients.length, isLoading: false, isFetching: false, isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useInfiniteClients>));
    setMissing({ data: missingData });
  });

  it("places the tab after 계약서 필요, intersects loaded rows in list order, and applies search", () => {
    renderPage(new QueryClient());
    const tabs = within(screen.getByTestId("list-card-filters")).getAllByRole("button");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "전체 3", "계약서 필요 3", "기록지 미작성 2", "진행 중 3",
    ]);
    expect(screen.getByRole("button", { name: "고객 1" })).toBeInTheDocument();
    fireEvent.click(tabs[2]);
    expect(screen.queryByRole("button", { name: "고객 1" })).not.toBeInTheDocument();
    const row3 = screen.getByRole("button", { name: "고객 3" });
    const row2 = screen.getByRole("button", { name: "고객 2" });
    expect(row3.compareDocumentPosition(row2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "고객 99" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "고객 검색" }), { target: { value: "고객 2" } });
    expect(screen.getByRole("button", { name: "기록지 미작성 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "고객 3" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "고객 검색" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "전체 3" }));
    expect(screen.getByRole("button", { name: "고객 1" })).toBeInTheDocument();
  });

  it("shows a skeleton count and rows while loading, then a successful zero", () => {
    setMissing({ isLoading: true });
    const queryClient = new QueryClient();
    const view = renderPage(queryClient);
    const tab = screen.getByRole("button", { name: /기록지 미작성/ });
    expect(within(tab).getByLabelText("개수 로딩 중")).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.queryByText("조건에 맞는 고객이 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "고객 3" })).not.toBeInTheDocument();
    setMissing({ data: { count: 0, items: [] } });
    view.rerender(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "기록지 미작성 0" })).toBeInTheDocument();
    expect(screen.getByText("조건에 맞는 고객이 없습니다.")).toBeInTheDocument();
  });

  it.each([undefined, { count: 0, items: [] }])("shows a retryable error without zero or an empty success list (cache: %j), then recovers", (data) => {
    setMissing({ data, isError: true });
    const queryClient = new QueryClient();
    const view = renderPage(queryClient);
    expect(screen.getByRole("button", { name: "고객 1" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기록지 미작성" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기록지 미작성 0" })).not.toBeInTheDocument();
    expect(screen.queryByText("조건에 맞는 고객이 없습니다.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMissing).toHaveBeenCalledTimes(1);
    setMissing({ data: missingData });
    view.rerender(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "고객 3" })).toBeInTheDocument();
  });

  it("keeps the list and an uncounted missing tab when the API returns a list-shaped body", async () => {
    const actualHooks = jest.requireActual<typeof import("@/features/clients/hooks/use-clients")>("@/features/clients/hooks/use-clients");
    mockedUseServiceRecordMissingClients.mockImplementation(actualHooks.useServiceRecordMissingClients);
    jest.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0 } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(queryClient.getQueryState(["clients", "service-record-missing"])?.status).toBe("error"));
    expect(screen.getByRole("button", { name: "고객 1" })).toBeInTheDocument();
    const tab = screen.getByRole("button", { name: "기록지 미작성" });
    expect(tab).toHaveTextContent(/^기록지 미작성\s*$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("조건에 맞는 고객이 없습니다.")).not.toBeInTheDocument();
    queryClient.clear();
  });

  it("keeps cached matching rows with a stale notice and hides the failed count", () => {
    setMissing({ data: missingData, isError: true });
    renderPage(new QueryClient());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기록지 미작성" }));
    expect(screen.getByRole("status")).toHaveTextContent("새로 불러오지 못해 최근에 확인된 목록을 표시하고 있어요");
    expect(screen.getByRole("button", { name: "고객 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "고객 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens a missing row on serviceRecords and an 전체 row on basic", async () => {
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    fireEvent.click(screen.getByRole("button", { name: "기록지 미작성 2" }));
    fireEvent.click(screen.getByRole("button", { name: "고객 3" }));
    await waitFor(() => expect(screen.getByTestId("client-detail-3")).toHaveAttribute("data-active-tab", "serviceRecords"));
    fireEvent.click(screen.getByRole("button", { name: "전체 3" }));
    // Changing the filter does not reset the already open client's selected tab.
    expect(screen.getByTestId("client-detail-3")).toHaveAttribute("data-active-tab", "serviceRecords");
    fireEvent.click(screen.getByRole("button", { name: "고객 1" }));
    await waitFor(() => expect(screen.getByTestId("client-detail-1")).toHaveAttribute("data-active-tab", "basic"));
  });
});
