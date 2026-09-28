import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clientsApi } from "../api/clients.api";
import type { Client } from "../types";
import { clientKeys } from "./keys";
import { useClient } from "./use-clients";

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
});
