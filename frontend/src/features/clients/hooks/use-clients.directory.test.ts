import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clientsApi } from "../api/clients.api";
import type { Client, ClientListSummary, PaginatedResponse } from "../types";
import {
  clientKeys,
  type ClientDirectoryKeyFilters,
} from "./keys";
import {
  useClientDirectory,
  useClientListSummary,
} from "./use-clients";

jest.mock("../api/clients.api", () => ({
  clientsApi: {
    list: jest.fn(),
    listSummary: jest.fn(),
    listAll: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    terminateService: jest.fn(),
    requestReplacement: jest.fn(),
    completeReplacement: jest.fn(),
    approveScheduleChange: jest.fn(),
    rejectScheduleChange: jest.fn(),
  },
}));

const mockList = jest.mocked(clientsApi.list);
const mockListSummary = jest.mocked(clientsApi.listSummary);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000 },
    },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function client(id: number): Client {
  return { id, name: `고객 ${id}` } as Client;
}

function page(
  pageNumber: number,
  total: number,
  totalPages: number,
  ids: number[],
  limit = 20,
): PaginatedResponse<Client> {
  return {
    data: ids.map(client),
    total,
    page: pageNumber,
    limit,
    totalPages,
  };
}

function summary(total: number): ClientListSummary {
  return {
    total,
    byTab: {
      all: total,
      pre_booking: 0,
      waiting: 0,
      replacement_requested: 0,
      active: total,
      completed: 0,
      terminated: 0,
    },
    dueDate: { thisMonth: 0, nextMonth: 0 },
    serviceEnd: { count: 0, from: "2026-09-29", to: "2026-10-02" },
  };
}

describe("useClientDirectory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = "selected_branch_id=branch-a; path=/";
  });

  it("loads every server page and keeps the matched total separate from loaded rows", async () => {
    mockList.mockImplementation(async ({ page: pageNumber = 1 } = {}) => {
      if (pageNumber === 1) return { data: page(1, 51, 3, [1, 2, 3]) } as never;
      if (pageNumber === 2) return { data: page(2, 51, 3, [4, 5, 6]) } as never;
      return { data: page(3, 51, 3, [7, 8]) } as never;
    });

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useClientDirectory({ branchId: "branch-a", search: " 김 ", tab: "active", limit: 20 }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.matchedTotal).toBe(51);
    expect(result.current.loadedCount).toBe(3);
    expect(result.current.hasNextPage).toBe(true);
    expect(mockList).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      search: " 김 ",
      tab: "active",
    });

    await act(async () => {
      await result.current.fetchNextPage();
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.isEndOfList).toBe(true));
    expect(mockList).toHaveBeenNthCalledWith(2, {
      page: 2,
      limit: 20,
      search: " 김 ",
      tab: "active",
    });
    expect(mockList).toHaveBeenNthCalledWith(3, {
      page: 3,
      limit: 20,
      search: " 김 ",
      tab: "active",
    });
    expect(result.current.loadedCount).toBe(8);
    expect(result.current.matchedTotal).toBe(51);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("exposes a successful empty state without deriving summary metrics from rows", async () => {
    mockList.mockResolvedValue({ data: page(1, 0, 0, []) } as never);
    mockListSummary.mockResolvedValue({ data: summary(0) } as never);

    const queryClient = createQueryClient();
    const wrapper = wrapperFor(queryClient);
    const directory = renderHook(
      () => useClientDirectory({ branchId: "branch-a", search: "없는 고객" }),
      { wrapper },
    );
    const metrics = renderHook(
      () => useClientListSummary({ branchId: "branch-a", search: "없는 고객" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(directory.result.current.isSuccessfulEmpty).toBe(true);
      expect(metrics.result.current.isSuccess).toBe(true);
    });
    expect(directory.result.current.clients).toEqual([]);
    expect(directory.result.current.matchedTotal).toBe(0);
    expect(metrics.result.current.data?.total).toBe(0);
    expect(mockListSummary).toHaveBeenCalledWith({ search: "없는 고객" });
  });

  it("keeps branch, search, and tab scopes isolated in directory and summary keys", () => {
    const base: ClientDirectoryKeyFilters = {
      branchId: "branch-a",
      search: "김",
      tab: "active",
      limit: 20,
    };

    expect(clientKeys.directory(base)).not.toEqual(
      clientKeys.directory({ ...base, branchId: "branch-b" }),
    );
    expect(clientKeys.directory(base)).not.toEqual(
      clientKeys.directory({ ...base, search: "이" }),
    );
    expect(clientKeys.directory(base)).not.toEqual(
      clientKeys.directory({ ...base, tab: "completed" }),
    );
    expect(clientKeys.summary({ branchId: "branch-a", search: "김" })).not.toEqual(
      clientKeys.summary({ branchId: "branch-b", search: "김" }),
    );
    expect(clientKeys.summary({ branchId: "branch-a", search: "김" })).not.toEqual(
      clientKeys.summary({ branchId: "branch-a", search: "이" }),
    );
  });

  it("does not flash an old scope while a rapid scope change is in flight", async () => {
    let resolveFirst: ((response: unknown) => void) | undefined;
    mockList.mockImplementation(({ search } = {}) => {
      if (search === "first") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never;
      }
      return Promise.resolve({ data: page(1, 1, 1, [2]) }) as never;
    });

    const queryClient = createQueryClient();
    const { result, rerender } = renderHook(
      ({ branchId, search }: { branchId: string; search: string }) =>
        useClientDirectory({ branchId, search }),
      {
        wrapper: wrapperFor(queryClient),
        initialProps: { branchId: "branch-a", search: "first" },
      },
    );

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ search: "first" })));
    document.cookie = "selected_branch_id=branch-b; path=/";
    rerender({ branchId: "branch-b", search: "second" });

    await waitFor(() => expect(result.current.clients.map(({ id }) => id)).toEqual([2]));
    await act(async () => {
      resolveFirst?.({ data: page(1, 1, 1, [1]) });
    });

    expect(result.current.clients.map(({ id }) => id)).toEqual([2]);
    expect(queryClient.getQueryData(clientKeys.directory({
      branchId: "branch-a",
      search: "first",
      tab: "all",
      limit: 20,
    }))).toBeDefined();
  });

  it("distinguishes initial, refresh, and next-page failures", async () => {
    mockList.mockRejectedValueOnce(new Error("initial failure"));
    const queryClient = createQueryClient();
    const initial = renderHook(
      () => useClientDirectory({ branchId: "branch-a", search: "initial" }),
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() => expect(initial.result.current.isInitialError).toBe(true));
    expect(initial.result.current.isRefreshError).toBe(false);

    mockList.mockResolvedValueOnce({ data: page(1, 2, 2, [1]) } as never);
    await act(async () => {
      await initial.result.current.refetch();
    });
    await waitFor(() => expect(initial.result.current.isSuccess).toBe(true));

    mockList.mockRejectedValueOnce(new Error("refresh failure"));
    await act(async () => {
      await initial.result.current.refetch();
    });
    await waitFor(() => expect(initial.result.current.isRefreshError).toBe(true));
    expect(initial.result.current.hasStaleData).toBe(true);
    expect(initial.result.current.clients.map(({ id }) => id)).toEqual([1]);

    mockList.mockRejectedValueOnce(new Error("next page failure"));
    await act(async () => {
      await initial.result.current.fetchNextPage();
    });
    await waitFor(() => expect(initial.result.current.isNextPageError).toBe(true));
    expect(initial.result.current.hasNextPage).toBe(true);
    expect(initial.result.current.isEndOfList).toBe(false);
    expect(initial.result.current.clients.map(({ id }) => id)).toEqual([1]);
  });
});
