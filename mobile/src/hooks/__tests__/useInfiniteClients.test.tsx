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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

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
});
