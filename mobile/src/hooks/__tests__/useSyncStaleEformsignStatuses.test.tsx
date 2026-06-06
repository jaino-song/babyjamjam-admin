import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys } from "@/hooks/useClients";
import { eformsignApi, withEformsignReauth } from "@/services/api";
import type { Client } from "@/lib/client/types";
import {
  __resetEformsignSyncGateForTests,
  useSyncStaleEformsignStatuses,
} from "../useSyncStaleEformsignStatuses";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    syncDocumentStatus: jest.fn(),
  },
  withEformsignReauth: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockedSyncDocumentStatus = eformsignApi.syncDocumentStatus as jest.MockedFunction<
  typeof eformsignApi.syncDocumentStatus
>;
const mockedWithEformsignReauth = withEformsignReauth as jest.MockedFunction<
  typeof withEformsignReauth
>;

function client(overrides: Partial<Client>): Client {
  return {
    id: 1,
    name: "송진호",
    birthday: null,
    dueDate: null,
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
    serviceStatus: "waiting",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSyncStaleEformsignStatuses", () => {
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetEformsignSyncGateForTests();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    mockedSyncDocumentStatus.mockReset();
    mockedSyncDocumentStatus.mockResolvedValue({
      documentId: "doc-1",
      statusType: "072",
      statusDetail: "완료",
      stepType: "07",
      stepIndex: "3",
      stepName: "제공기관 검토",
    });
    mockedWithEformsignReauth.mockClear();
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
  });

  it("syncs non-completed eformsign documents and refreshes dashboard caches", async () => {
    renderHook(
      () =>
        useSyncStaleEformsignStatuses([
          client({
            eDocId: "doc-1",
            documentStatus: "requested",
          }),
        ]),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(mockedSyncDocumentStatus).toHaveBeenCalledWith("doc-1"));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: clientQueryKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dashboardQueryKeys.analytics() });
    });
  });

  it("skips completed, missing, duplicate, and disabled document syncs", async () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useSyncStaleEformsignStatuses(
          [
            client({ id: 1, eDocId: "doc-1", documentStatus: "completed" }),
            client({ id: 2, eDocId: null, documentStatus: "requested" }),
            client({ id: 3, eDocId: "doc-2", documentStatus: "requested" }),
            client({ id: 4, eDocId: "doc-2", documentStatus: "opened" }),
          ],
          { enabled },
        ),
      {
        initialProps: { enabled: false },
        wrapper: createWrapper(queryClient),
      },
    );

    await Promise.resolve();
    expect(mockedSyncDocumentStatus).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(mockedSyncDocumentStatus).toHaveBeenCalledTimes(1));
    expect(mockedSyncDocumentStatus).toHaveBeenCalledWith("doc-2");
  });

  it("does not re-sync the same document across remounts within the retry interval", async () => {
    const pendingClients = [client({ eDocId: "doc-1", documentStatus: "requested" })];

    const { unmount } = renderHook(() => useSyncStaleEformsignStatuses(pendingClients), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(mockedSyncDocumentStatus).toHaveBeenCalledTimes(1));
    unmount();

    renderHook(() => useSyncStaleEformsignStatuses(pendingClients), {
      wrapper: createWrapper(queryClient),
    });

    await Promise.resolve();
    expect(mockedSyncDocumentStatus).toHaveBeenCalledTimes(1);
  });
});
