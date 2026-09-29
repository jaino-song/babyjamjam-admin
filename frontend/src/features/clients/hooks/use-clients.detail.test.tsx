import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clientsApi } from "../api/clients.api";
import type { Client, PaginatedResponse } from "../types";
import { clientKeys } from "./keys";
import { useClient, useUpdateClient } from "./use-clients";

let mockActiveBranchId: string | null = "branch-a";
let mockCookieBranchId: string | null = "branch-a";

jest.mock("@/features/system-templates/branch-context", () => ({
  getActiveBranchId: () => mockCookieBranchId,
  isBranchContextAligned: (branchId: string | null) => (
    branchId !== null && branchId === mockCookieBranchId
  ),
  useActiveBranchId: () => mockActiveBranchId,
}));

jest.mock("../api/clients.api", () => ({
  clientsApi: {
    getById: jest.fn(),
    list: jest.fn(),
    listSummary: jest.fn(),
    listAll: jest.fn(),
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

const mockGetById = jest.mocked(clientsApi.getById);
const mockUpdate = jest.mocked(clientsApi.update);

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

function client(id: number, name: string): Client {
  return { id, name } as Client;
}

function clientPage(value: Client): PaginatedResponse<Client> {
  return {
    data: [value],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };
}

describe("useClient branch-scoped detail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveBranchId = "branch-a";
    mockCookieBranchId = "branch-a";
  });

  it("keeps the legacy detail key as a prefix for branch-scoped cache entries", () => {
    const queryClient = createQueryClient();
    const branchAKey = clientKeys.detail(42, "branch-a");
    const branchBKey = clientKeys.detail(42, "branch-b");

    queryClient.setQueryData(branchAKey, client(42, "지점 A 고객"));

    expect(branchAKey).not.toEqual(branchBKey);
    expect(clientKeys.detail(42)).toEqual(["clients", "detail", 42]);
    expect(queryClient.getQueriesData({ queryKey: clientKeys.detail(42) })).toEqual([
      [branchAKey, { id: 42, name: "지점 A 고객" }],
    ]);
  });

  it("hides old detail data during a cookie transition and loads the new branch detail", async () => {
    const branchAClient = client(42, "지점 A 고객");
    const branchBClient = client(42, "지점 B 고객");
    mockGetById.mockImplementation(async () => ({
      data: mockActiveBranchId === "branch-a" ? branchAClient : branchBClient,
    }) as never);

    const queryClient = createQueryClient();
    const { result, rerender } = renderHook(() => useClient(42), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(branchAClient));
    expect(queryClient.getQueryData(clientKeys.detail(42, "branch-a"))).toEqual(branchAClient);

    mockCookieBranchId = "branch-b";
    rerender();

    expect(result.current.isBranchContextReady).toBe(false);
    expect(result.current.data).toBeUndefined();

    mockActiveBranchId = "branch-b";
    rerender();

    await waitFor(() => expect(result.current.data).toEqual(branchBClient));
    expect(queryClient.getQueryData(clientKeys.detail(42, "branch-a"))).toEqual(branchAClient);
    expect(queryClient.getQueryData(clientKeys.detail(42, "branch-b"))).toEqual(branchBClient);
  });

  it("does not patch branch B caches when an A update resolves after the cookie switches", async () => {
    const branchBClient = client(42, "지점 B 고객");
    const branchAUpdatedClient = client(42, "지점 A 수정 고객");
    const branchBListKey = clientKeys.list({
      branchId: "branch-b",
      page: 1,
      limit: 20,
    });
    const branchBDetailKey = clientKeys.detail(42, "branch-b");
    const branchBList = clientPage(branchBClient);
    let resolveUpdate: ((response: unknown) => void) | undefined;
    mockUpdate.mockImplementation(() => new Promise((resolve) => {
      resolveUpdate = resolve;
    }) as never);

    const queryClient = createQueryClient();
    queryClient.setQueryData(branchBListKey, branchBList);
    queryClient.setQueryData(branchBDetailKey, branchBClient);
    const { result } = renderHook(() => useUpdateClient(), {
      wrapper: wrapperFor(queryClient),
    });

    let updatePromise: Promise<unknown> | undefined;
    await act(async () => {
      updatePromise = result.current.mutateAsync({ id: 42, dto: { name: "수정" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(42, { name: "수정" }));

    mockCookieBranchId = "branch-b";
    const resolve = resolveUpdate;
    const pendingUpdate = updatePromise;
    if (!resolve || !pendingUpdate) {
      throw new Error("deferred update was not initialized");
    }

    await act(async () => {
      resolve({ data: branchAUpdatedClient });
      await pendingUpdate;
    });

    expect(queryClient.getQueryData(branchBListKey)).toEqual(branchBList);
    expect(queryClient.getQueryData(branchBDetailKey)).toEqual(branchBClient);
    expect(queryClient.getQueryData(clientKeys.detail(42))).toBeUndefined();
  });

  it("patches the captured branch detail and list caches when the branch stays aligned", async () => {
    const branchAClient = client(42, "지점 A 고객");
    const branchAUpdatedClient = client(42, "지점 A 수정 고객");
    const branchAListKey = clientKeys.list({
      branchId: "branch-a",
      page: 1,
      limit: 20,
    });
    const branchADetailKey = clientKeys.detail(42, "branch-a");
    mockUpdate.mockResolvedValue({ data: branchAUpdatedClient } as never);

    const queryClient = createQueryClient();
    queryClient.setQueryData(branchAListKey, clientPage(branchAClient));
    queryClient.setQueryData(branchADetailKey, branchAClient);
    const { result } = renderHook(() => useUpdateClient(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 42, dto: { name: "수정" } });
    });

    expect(queryClient.getQueryData(branchAListKey)).toEqual(clientPage(branchAUpdatedClient));
    expect(queryClient.getQueryData(branchADetailKey)).toEqual(branchAUpdatedClient);
  });
});
