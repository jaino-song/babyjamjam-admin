import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { useInfiniteContracts } from "../useInfiniteContracts";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    getAllDocuments: jest.fn(),
    getInProgressDocuments: jest.fn(),
    getCompletedDocuments: jest.fn(),
    getExpiredDocuments: jest.fn(),
  },
}));

const mockedApi = eformsignApi as jest.Mocked<typeof eformsignApi>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function emptyPage() {
  return { documents: [], total_rows: 0, limit: 20, skip: 0 };
}

describe("useInfiniteContracts — the All tab and deletion tombstones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getAllDocuments.mockResolvedValue(emptyPage() as never);
    mockedApi.getExpiredDocuments.mockResolvedValue(emptyPage() as never);
  });

  it("asks the server to leave deleted contracts out of the All tab", async () => {
    // A permanent delete scrubs the contract and leaves a 049 tombstone behind.
    // Without this flag the All tab renders that emptied row straight back at the
    // user after they deleted it. Mobile has always sent it; this is the desktop
    // side of the same contract.
    renderHook(() => useInfiniteContracts({ filterType: null }), { wrapper });

    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalled());

    expect(mockedApi.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDeleted: true }),
    );
  });

  it("leaves the 기간 만료 tab alone, which is where deleted contracts belong", async () => {
    renderHook(() => useInfiniteContracts({ filterType: "expired" }), { wrapper });

    await waitFor(() => expect(mockedApi.getExpiredDocuments).toHaveBeenCalled());

    expect(mockedApi.getExpiredDocuments).not.toHaveBeenCalledWith(
      expect.objectContaining({ excludeDeleted: true }),
    );
  });

  it("restarts desktop offset pagination when the semantic snapshot changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const documents = Array.from({ length: 20 }, (_, index) => ({
      id: `document-${index + 1}`,
      created_date: 100 - index,
      current_status: { status_type: "060" },
    }));
    const firstPage = {
      documents,
      total_rows: 21,
      limit: 20,
      skip: 0,
      has_more: true,
      snapshot_version: "1:100",
    };
    const conflictingPage = {
      documents: [{
        id: "document-21",
        created_date: 79,
        current_status: { status_type: "060" },
      }],
      total_rows: 20,
      limit: 20,
      skip: 20,
      has_more: false,
      snapshot_version: "1:100:fvisibility",
    };
    mockedApi.getAllDocuments
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(conflictingPage as never)
      .mockResolvedValue(firstPage as never);
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useInfiniteContracts({ filterType: null }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: expect.arrayContaining(["infinite", "all"]),
      exact: true,
    });
  });

  it("keeps the first page visible while restarting a changed snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const documents = Array.from({ length: 20 }, (_, index) => ({
      id: `document-${index + 1}`,
      created_date: 100 - index,
      current_status: { status_type: "060" },
    }));
    const firstPage = {
      documents,
      total_rows: 21,
      limit: 20,
      skip: 0,
      has_more: true,
      snapshot_version: "1:100",
    };
    const conflictingPage = {
      documents: [{
        id: "document-21",
        created_date: 79,
        current_status: { status_type: "060" },
      }],
      total_rows: 21,
      limit: 20,
      skip: 20,
      has_more: false,
      snapshot_version: "2:200",
    };
    const pendingRestart = new Promise<never>(() => undefined);
    mockedApi.getAllDocuments
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(conflictingPage as never)
      .mockReturnValue(pendingRestart);
    const resetQueries = jest.spyOn(queryClient, "resetQueries");
    const { result } = renderHook(
      () => useInfiniteContracts({ filterType: null }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalledTimes(3));

    expect(resetQueries).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.documents).toEqual(documents);
  });

  it("re-arms the desktop drift guard after pagination becomes coherent", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const documents = Array.from({ length: 20 }, (_, index) => ({
      id: `document-${index + 1}`,
      created_date: 100 - index,
      current_status: { status_type: "060" },
    }));
    const firstPage = {
      documents,
      total_rows: 21,
      limit: 20,
      skip: 0,
      has_more: true,
      snapshot_version: "1:100",
    };
    const conflictingPage = {
      documents: [{
        id: "document-21",
        created_date: 79,
        current_status: { status_type: "060" },
      }],
      total_rows: 21,
      limit: 20,
      skip: 20,
      has_more: false,
    };
    mockedApi.getAllDocuments
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(conflictingPage as never)
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(conflictingPage as never)
      .mockResolvedValue(firstPage as never);
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useInfiniteContracts({ filterType: null }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalledTimes(3));

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["the later page omits it", "1:100", undefined],
    ["the first page omits it", undefined, "1:100"],
  ])(
    "restarts desktop offset pagination when %s",
    async (_description, firstSnapshotVersion, laterSnapshotVersion) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const documents = Array.from({ length: 20 }, (_, index) => ({
        id: `document-${index + 1}`,
        created_date: 100 - index,
        current_status: { status_type: "060" },
      }));
      const firstPage = {
        documents,
        total_rows: 21,
        limit: 20,
        skip: 0,
        has_more: true,
        ...(firstSnapshotVersion === undefined
          ? {}
          : { snapshot_version: firstSnapshotVersion }),
      };
      const laterPage = {
        documents: [{
          id: "document-21",
          created_date: 79,
          current_status: { status_type: "060" },
        }],
        total_rows: 21,
        limit: 20,
        skip: 20,
        has_more: false,
        ...(laterSnapshotVersion === undefined
          ? {}
          : { snapshot_version: laterSnapshotVersion }),
      };
      mockedApi.getAllDocuments
        .mockResolvedValueOnce(firstPage as never)
        .mockResolvedValueOnce(laterPage as never)
        .mockResolvedValue(firstPage as never);
      const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(
        () => useInfiniteContracts({ filterType: null }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.hasNextPage).toBe(true));
      await act(async () => {
        await result.current.fetchNextPage();
      });

      await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
    },
  );
});

describe("useInfiniteContracts — voided (파기됨) documents are never live (BJJ-439)", () => {
  function doc(id: string, code: string, displayStatus?: string) {
    return {
      id,
      created_date: 100,
      current_status: { status_type: code },
      ...(displayStatus ? { display_status: displayStatus } : {}),
    };
  }
  function pageOf(documents: unknown[]) {
    return { documents, total_rows: documents.length, limit: 20, skip: 0 };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps a voided document on the expired tab whatever its provider code says", async () => {
    // The server filed it under expired; the client-side code re-check used to drop 060/003/070.
    mockedApi.getExpiredDocuments.mockResolvedValue(
      pageOf([doc("v-060", "060", "voided"), doc("v-003", "003", "voided"), doc("v-070", "070", "voided")]) as never,
    );
    const { result } = renderHook(() => useInfiniteContracts({ filterType: "expired" }), { wrapper });

    await waitFor(() => expect(result.current.documents).toHaveLength(3));
    expect(result.current.documents.map((d) => d.id).sort()).toEqual(["v-003", "v-060", "v-070"]);
  });

  it.each([
    ["in-progress", "getInProgressDocuments", "060"],
    ["completed", "getCompletedDocuments", "003"],
  ] as const)("excludes a voided document from the %s tab re-check", async (filterType, apiName, code) => {
    mockedApi[apiName].mockResolvedValue(
      pageOf([doc("voided", code, "voided"), doc("live", code)]) as never,
    );
    const { result } = renderHook(() => useInfiniteContracts({ filterType }), { wrapper });

    await waitFor(() => expect(result.current.documents.length).toBeGreaterThan(0));
    expect(result.current.documents.map((d) => d.id)).toEqual(["live"]);
  });

  it("leaves non-voided documents classified by their code on the expired tab", async () => {
    mockedApi.getExpiredDocuments.mockResolvedValue(
      pageOf([doc("exp", "080"), doc("wrong-tab", "060")]) as never,
    );
    const { result } = renderHook(() => useInfiniteContracts({ filterType: "expired" }), { wrapper });

    await waitFor(() => expect(result.current.documents.length).toBeGreaterThan(0));
    expect(result.current.documents.map((d) => d.id)).toEqual(["exp"]);
  });

  it("does not hide a voided document on the All tab", async () => {
    mockedApi.getAllDocuments.mockResolvedValue(
      pageOf([doc("v", "060", "voided"), doc("p", "060")]) as never,
    );
    const { result } = renderHook(() => useInfiniteContracts({ filterType: null }), { wrapper });

    await waitFor(() => expect(result.current.documents).toHaveLength(2));
  });
});
