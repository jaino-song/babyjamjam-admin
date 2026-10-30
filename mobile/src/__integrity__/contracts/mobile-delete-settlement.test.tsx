import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";
import type { EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { useDeleteEformsignDocument, useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";

/**
 * SI-CONTRACT-08 (mobile, delete settlement) — the optimistic document delete
 * deliberately has no rollback. The verdict: does a FAILED delete leave the
 * list permanently wrong? `onSettled` still invalidates the documents root, so
 * a mounted list query refetches the server truth and self-heals within one
 * refetch window; until that refetch lands the optimistic state is kept (never
 * rolled back to the pre-delete snapshot).
 */

jest.mock("@/services/api", () => ({
  eformsignApi: {
    deleteDocument: jest.fn(),
    getAllDocuments: jest.fn(),
    getInProgressDocuments: jest.fn(),
    getCompletedDocuments: jest.fn(),
    getRejectedDocuments: jest.fn(),
  },
  withEformsignReauth: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockedDeleteDocument = eformsignApi.deleteDocument as jest.MockedFunction<typeof eformsignApi.deleteDocument>;
const mockedGetAllDocuments = eformsignApi.getAllDocuments as jest.MockedFunction<typeof eformsignApi.getAllDocuments>;

const serverTruth = (): EformsignDocumentsResponse =>
  ({
    // `created_date` order matters: the hook sorts newest first (doc-1 stays first).
    documents: [{ id: "doc-1", created_date: 2 }, { id: "doc-2", created_date: 1 }],
    total_rows: 2,
  }) as unknown as EformsignDocumentsResponse;

const idsOf = (results: EformsignDocumentsResponse | undefined): string[] =>
  (results?.documents ?? []).map((doc) => doc.id);

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("SI-CONTRACT-08 mobile document delete settlement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SI-CONTRACT-08 a FAILED optimistic delete self-heals: the settlement invalidation refetches the documents root and the server truth returns", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    // The list is served with the document still present server-side (the
    // backend can retain a purge intent and still error on a later step).
    mockedGetAllDocuments.mockResolvedValue(serverTruth());
    mockedDeleteDocument.mockRejectedValue(new Error("vendor steps failed after purge"));

    const wrapper = makeWrapper(queryClient);
    const { result: list } = renderHook(() => useEformsignDocumentsByType(true, null), { wrapper });
    await waitFor(() => expect(idsOf(list.current.data)).toEqual(["doc-1", "doc-2"]));

    const { result: deleter } = renderHook(() => useDeleteEformsignDocument(), { wrapper });
    deleter.current.mutate("doc-1");

    // The failed request must not stay: `onSettled` runs on error too, so the
    // mounted list query refetches and the server truth is restored after one
    // refetch. The hypothesis ("permanently wrong until refetch") is refuted —
    // the list heals within its own settlement refetch. (The optimistic window
    // in between is asserted by the held-refetch test below.)
    await waitFor(() => expect(deleter.current.isError).toBe(true));
    await waitFor(() => {
      expect(idsOf(list.current.data)).toEqual(["doc-1", "doc-2"]);
    });
    expect(mockedGetAllDocuments.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("SI-CONTRACT-08 while the settlement refetch is pending, a failed delete keeps the optimistic state instead of resurrecting the stale snapshot", async () => {
    let releaseRefetch!: (value: unknown) => void;
    const pendingRefetch = new Promise<unknown>((resolve) => {
      releaseRefetch = resolve;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    // First load resolves immediately; the settlement refetch is held so its
    // result cannot mask the optimistic state while the mutation fails.
    mockedGetAllDocuments.mockResolvedValueOnce(serverTruth());
    mockedGetAllDocuments.mockReturnValueOnce(pendingRefetch as never);
    mockedDeleteDocument.mockRejectedValue(new Error("vendor steps failed after purge"));

    const wrapper = makeWrapper(queryClient);
    const { result: list } = renderHook(() => useEformsignDocumentsByType(true, null), { wrapper });
    await waitFor(() => expect(idsOf(list.current.data)).toEqual(["doc-1", "doc-2"]));

    const { result: deleter } = renderHook(() => useDeleteEformsignDocument(), { wrapper });
    deleter.current.mutate("doc-1");
    await waitFor(() => expect(deleter.current.isError).toBe(true));

    // No rollback: before the refetch lands, the cached list keeps the
    // optimistic state. The pre-delete snapshot never comes back on its own.
    expect(idsOf(list.current.data)).toEqual(["doc-2"]);

    // The held refetch then serves the server truth; the list heals.
    releaseRefetch(serverTruth());
    await waitFor(() => {
      expect(idsOf(list.current.data)).toEqual(["doc-1", "doc-2"]);
    });
    expect(mockedGetAllDocuments.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
