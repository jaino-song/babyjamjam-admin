import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { clientKeys } from "@/features/clients/hooks/keys";

import type { Client } from "@/features/clients/types";

/*
 * SI-CLIENT-08 — desktop state-integrity behaviour (real QueryClient, HTTP mocked).
 *
 * Convention note: the backend harness owns `invariant`/`knownDefect`; client
 * suites implement the same semantics locally — `it` for an invariant that must
 * hold, `it.failing` for a tracked defect — with the id prefix in the name.
 */

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/features/system-templates/branch-context", () => ({
  getActiveBranchId: () => "branch-a",
  isBranchContextAligned: () => true,
  useActiveBranchId: () => "branch-a",
}));

const { useUpdateClient, useDeleteClient } = jest.requireActual<
  typeof import("@/features/clients/hooks/use-clients")
>("@/features/clients/hooks/use-clients");

const apiMock = api as unknown as Record<"get" | "post" | "patch" | "put" | "delete", jest.Mock>;

const client = (id: number): Client => ({
  id,
  name: `고객 ${id}`,
  phone: "010-0000-0000",
  phoneNormalized: "01000000000",
  voucherClient: false,
  breastPump: false,
  smsAutomationEnabled: true,
  serviceStatus: "active",
  bookingConfirmedAt: null,
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-16T00:00:00.000Z",
} as unknown as Client);

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries").mockImplementation(async () => undefined);
  const refetchSpy = jest.spyOn(queryClient, "refetchQueries").mockImplementation(async () => ({ pages: 1 } as never));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, refetchSpy, wrapper };
}

describe("SI-CLIENT-08 desktop client mutation cache invalidation", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    apiMock.delete.mockReset();
  });

  it("SI-CLIENT-08 desktop useUpdateClient invalidates clientKeys.all, messageTriggerKeys.upcoming() and refetches the service-record client overview", async () => {
    const updated = { ...client(42), name: "수정 고객" };
    apiMock.patch.mockResolvedValue({ data: updated });
    const { invalidateSpy, refetchSpy, wrapper } = setup();

    const { result } = renderHook(() => useUpdateClient(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 42, dto: { name: "수정 고객" } });
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
    if (!invalidatedKeys.includes(JSON.stringify({ queryKey: clientKeys.all }))) {
      throw new Error("SI-CLIENT-08: desktop useUpdateClient did not invalidate clientKeys.all");
    }
    if (!invalidatedKeys.includes(JSON.stringify({ queryKey: messageTriggerKeys.upcoming() }))) {
      throw new Error("SI-CLIENT-08: desktop useUpdateClient did not invalidate messageTriggerKeys.upcoming()");
    }
    if (!refetchSpy.mock.calls.some((call) => JSON.stringify(call[0]).includes(JSON.stringify(serviceRecordKeys.clientOverview(42))))) {
      throw new Error("SI-CLIENT-08: desktop useUpdateClient did not refetch the service-record client overview");
    }
  });

  it("SI-CLIENT-08 desktop useDeleteClient removes the client optimistically and restores the cache when the delete fails", async () => {
    const { invalidateSpy, wrapper, queryClient } = setup();
    const listKey = clientKeys.list({ page: 1, limit: 10, branchId: "branch-a", tab: "all" });
    queryClient.setQueryData(listKey, {
      data: [client(7), client(8)],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
    apiMock.delete.mockRejectedValue(new Error("delete refused"));

    const { result } = renderHook(() => useDeleteClient(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(7).catch((error: unknown) => error);
    });

    const cached = queryClient.getQueryData<{ data: Client[]; total: number }>(listKey);
    const stillContains = cached?.data.some((entry) => entry.id === 7) ?? false;
    if (!stillContains) {
      throw new Error("SI-CLIENT-08: desktop useDeleteClient did not restore the optimistic removal on failure");
    }
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
    if (!invalidatedKeys.includes(JSON.stringify({ queryKey: clientKeys.all }))) {
      throw new Error("SI-CLIENT-08: desktop useDeleteClient did not invalidate clientKeys.all on settle");
    }
    if (!invalidatedKeys.includes(JSON.stringify({ queryKey: messageTriggerKeys.upcoming() }))) {
      throw new Error("SI-CLIENT-08: desktop useDeleteClient did not invalidate messageTriggerKeys.upcoming() on settle");
    }
  });
});
