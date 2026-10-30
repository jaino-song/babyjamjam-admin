import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { serviceRecordQueryKeys } from "@/hooks/useServiceRecords";

import { clientQueryKeys, useDeleteClient, useUpdateClient } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";

/*
 * SI-CLIENT-08 — mobile parity with desktop (real QueryClient, HTTP mocked).
 *
 * The mobile client-detail page is LIVE only for patch/delete-style mutations
 * from `mobile/src/hooks/useClients.ts`; `mobile/src/features/clients/hooks/`
 * is live only for useConfirmBooking (tested elsewhere), so its unused hooks
 * are out of scope here.
 *
 * Convention note: `it` = an invariant that must hold today; `it.failing` = a
 * tracked defect whose fix should flip this back to `it`.
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

const apiMock = api as unknown as Record<"get" | "post" | "patch" | "put" | "delete", jest.Mock>;

/**
 * Local knownDefect semantics (same contract as the backend harness helper):
 * `it.failing` expects the test to fail; an `expectedFailure` pattern closes the
 * any-error-green hole — a failure matching the pattern is rethrown (stays
 * green), a failure for ANY other reason (or an unexpected pass) returns
 * normally so `it.failing` reports RED.
 */
function knownDefect(
    id: string,
    title: string,
    body: () => Promise<void>,
    expectedFailure: RegExp,
): void {
    it.failing(`${id} ${title}`, async () => {
        try {
            await body();
            return; // passed while the defect exists → unexpected → RED
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (expectedFailure.test(message)) throw error; // the tracked failure → green
            console.error(`[knownDefect] ${id} ${title}: expected failure ${String(expectedFailure)} but failed for another reason: ${message}`);
            return; // different reason → RED
        }
    });
}

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
  const invalidatedKeys = () => invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
  const refetchedKeys = () => refetchSpy.mock.calls.map((call) => JSON.stringify(call[0]));
  return { queryClient, invalidatedKeys, refetchedKeys, wrapper };
}

describe("SI-CLIENT-08 mobile client mutation cache invalidation", () => {
  knownDefect(
    "SI-CLIENT-08",
    "mobile useUpdateClient invalidates the same dependent caches desktop does (message-trigger upcoming + service-record client overview)",
    async () => {
      const updated = { ...client(42), name: "수정 고객" };
      apiMock.patch.mockResolvedValue({ data: updated });
      const { invalidatedKeys, refetchedKeys, wrapper } = setup();

      const { result } = renderHook(() => useUpdateClient(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: 42, dto: { name: "수정 고객" } });
      });

      // Desktop (frontend/src/features/clients/hooks/use-clients.ts) does both
      // of these on every update; mobile's update only refreshes clients and
      // the dashboard counters.
      const allInvalidations = invalidatedKeys().join("\n");
      if (!allInvalidations.includes(JSON.stringify(messageTriggerKeys.upcoming()))) {
        throw new Error(
          `SI-CLIENT-08: mobile useUpdateClient left the message-trigger upcoming cache stale (desktop invalidates it); invalidated: ${allInvalidations}`,
        );
      }
      if (!refetchedKeys().join("\n").includes(JSON.stringify(serviceRecordQueryKeys.clientOverview(42)))) {
        throw new Error(
          `SI-CLIENT-08: mobile useUpdateClient left the service-record client overview cache stale (desktop refetches it); refetched: ${refetchedKeys().join("\n")}`,
        );
      }
    },
    /SI-CLIENT-08: mobile useUpdateClient left the (message-trigger upcoming|service-record client overview) cache stale/,
  );

  it(
    "SI-CLIENT-08 mobile useDeleteClient invalidates the message-trigger upcoming cache (delete-side parity holds)",
    async () => {
      apiMock.delete.mockResolvedValue(undefined);
      const { invalidatedKeys, wrapper } = setup();

      const { result } = renderHook(() => useDeleteClient(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync(7);
      });

      const allInvalidations = invalidatedKeys().join("\n");
      if (!allInvalidations.includes(JSON.stringify(messageTriggerKeys.upcoming()))) {
        throw new Error(
          `SI-CLIENT-08: mobile useDeleteClient no longer invalidates the message-trigger upcoming cache; invalidated: ${allInvalidations}`,
        );
      }
    },
  );

  it(
    "SI-CLIENT-08 mobile useDeleteClient removes the client optimistically and restores the cache when the delete fails",
    async () => {
      const { queryClient, wrapper } = setup();
      const listKey = clientQueryKeys.list(1, 10);
      queryClient.setQueryData(listKey, {
        data: [client(7), client(8)],
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      const allKey = clientQueryKeys.all;
      queryClient.setQueryData(allKey, [client(7), client(8)]);

      apiMock.delete.mockRejectedValue(new Error("delete refused"));

      const { result } = renderHook(() => useDeleteClient(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync(7).catch((error: unknown) => error);
      });

      const cachedList = queryClient.getQueryData<{ data: Client[]; total: number }>(listKey);
      const cachedAll = queryClient.getQueryData<Client[]>(allKey);
      const listStillHas = cachedList?.data.some((entry) => entry.id === 7) ?? false;
      const allStillHas = cachedAll?.some((entry) => entry.id === 7) ?? false;
      if (!listStillHas || !allStillHas) {
        throw new Error(
          `SI-CLIENT-08: mobile useDeleteClient did not restore the optimistic removal on failure (list=${String(listStillHas)}, all=${String(allStillHas)})`,
        );
      }
    },
  );
});
