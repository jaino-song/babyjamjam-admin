import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import type { Client, PaginatedResponse } from "@/lib/client/types";
import { useInfiniteClients } from "../useInfiniteClients";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;

function createClient(id: number): Client {
  return {
    id,
    name: `Client ${id}`,
  } as Client;
}

function createResponse(count: number): PaginatedResponse<Client> {
  const clients = Array.from({ length: count }, (_, index) => createClient(index + 1));
  return {
    data: clients,
    total: count,
    page: 1,
    limit: 50,
    totalPages: 1,
  };
}

function createPageResponse(page: number, total: number, count: number): PaginatedResponse<Client> {
  const offset = (page - 1) * 50;
  const clients = Array.from({ length: count }, (_, index) => createClient(offset + index + 1));
  return {
    data: clients,
    total,
    page,
    limit: 50,
    totalPages: Math.ceil(total / 50),
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient = createQueryClient()) {

  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useInfiniteClients", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it("does not report another page when filtered results exactly fill the initial page", async () => {
    mockedApiGet.mockResolvedValue({ data: createResponse(6) });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.clients).toHaveLength(6);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("keeps visible clients clamped when load more is invoked after the final page", async () => {
    mockedApiGet.mockResolvedValue({ data: createResponse(12) });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.fetchNextPage();
    });

    expect(result.current.clients).toHaveLength(12);
    expect(result.current.hasNextPage).toBe(false);

    act(() => {
      result.current.fetchNextPage();
    });

    expect(result.current.clients).toHaveLength(12);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("falls back to loaded client count when the API omits total", async () => {
    const responseWithoutTotal = createResponse(3) as Partial<PaginatedResponse<Client>>;
    delete responseWithoutTotal.total;
    mockedApiGet.mockResolvedValue({ data: responseWithoutTotal as PaginatedResponse<Client> });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.allClients).toHaveLength(3);
    expect(result.current.total).toBe(3);
  });

  it("loads all backend pages instead of stopping at the first 50 clients", async () => {
    mockedApiGet.mockImplementation(async (url) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      const page = Number(query.get("page"));

      return {
        data: page === 1
          ? createPageResponse(1, 51, 50)
          : createPageResponse(2, 51, 1),
      };
    });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.allClients).toHaveLength(51);
    expect(result.current.total).toBe(51);
    expect(mockedApiGet).toHaveBeenCalledWith("/clients?page=1&limit=50");
    expect(mockedApiGet).toHaveBeenCalledWith("/clients?page=2&limit=50");
  });

  it("deduplicates overlapping pages by first client occurrence", async () => {
    const firstPageClients = [createClient(1), createClient(2)];
    const secondPageClients = [createClient(2), createClient(3)];

    mockedApiGet.mockImplementation(async (url) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      const page = Number(query.get("page"));

      return {
        data: {
          data: page === 1 ? firstPageClients : secondPageClients,
          total: 4,
          page,
          limit: 50,
          totalPages: 2,
        },
      };
    });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.allClients.map((client) => client.id)).toEqual([1, 2, 3]);
  });

  it("does not publish page one while a later page is still pending", async () => {
    let resolvePageTwo: ((value: { data: PaginatedResponse<Client> }) => void) | undefined;
    const pageTwo = new Promise<{ data: PaginatedResponse<Client> }>((resolve) => {
      resolvePageTwo = resolve;
    });

    mockedApiGet.mockImplementation(async (url) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      const page = Number(query.get("page"));

      if (page === 1) {
        return { data: createPageResponse(1, 51, 50) };
      }

      return pageTwo;
    });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledWith("/clients?page=2&limit=50"));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.allClients).toHaveLength(0);

    resolvePageTwo?.({ data: createPageResponse(2, 51, 1) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.allClients).toHaveLength(51);
  });

  it("exposes the query error and refetch when a later page rejects", async () => {
    let pageTwoCalls = 0;
    mockedApiGet.mockImplementation(async (url) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      const page = Number(query.get("page"));

      if (page === 1) {
        return { data: createPageResponse(1, 51, 50) };
      }

      pageTwoCalls += 1;
      if (pageTwoCalls === 1) {
        throw new Error("page two failed");
      }

      return { data: createPageResponse(2, 51, 1) };
    });

    const { result } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.allClients).toHaveLength(0);
    expect(result.current.refetch).toEqual(expect.any(Function));

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.allClients).toHaveLength(51);
  });

  it("keeps the five-minute default while accepting a custom stale time", async () => {
    mockedApiGet.mockResolvedValue({ data: createResponse(1) });
    const defaultQueryClient = createQueryClient();
    const { result: defaultResult } = renderHook(() => useInfiniteClients(), {
      wrapper: createWrapper(defaultQueryClient),
    });

    await waitFor(() => expect(defaultResult.current.isLoading).toBe(false));

    const defaultQuery = defaultQueryClient.getQueryCache().find({
      queryKey: ["clients", "list", { scope: "all-pages", limit: 50 }],
    });
    const defaultQueryOptions = defaultQuery?.options as { staleTime?: number } | undefined;
    expect(defaultQueryOptions?.staleTime).toBe(5 * 60 * 1000);

    const queryClient = createQueryClient();
    const { result } = renderHook(() => useInfiniteClients({ staleTime: 60_000 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const query = queryClient.getQueryCache().find({
      queryKey: ["clients", "list", { scope: "all-pages", limit: 50 }],
    });
    const queryOptions = query?.options as { staleTime?: number } | undefined;
    expect(queryOptions?.staleTime).toBe(60_000);
  });
});
