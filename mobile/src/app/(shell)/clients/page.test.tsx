import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Client } from "@/lib/client/types";
import { fetchClient, useClient, useDeleteClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import ClientsPage from "./page";

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
    filters: Array<{ label: string; count: ReactNode }>;
    onFilterChange?: (label: string) => void;
    title?: string;
  }) => (
    <div>
      {title ? <div data-testid="list-card-header-count">{title} {count}</div> : null}
      {beforeFilters}
      <div>
        {filters.map((filter) => (
          <button key={filter.label} type="button" onClick={() => onFilterChange?.(filter.label)}>
            {filter.label} {filter.count}
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
    onDelete,
  }: {
    client: Client;
    onDelete: (id: number) => void;
  }) => (
    <div data-testid={`client-detail-${client.id}`}>
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
