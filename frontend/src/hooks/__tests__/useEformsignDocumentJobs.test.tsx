import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";

import {
  eformsignDocumentJobsQueryKeys,
  type EformsignDocumentJobList,
  useEformsignDocumentJobs,
  useEformsignDocumentJobsSummary,
} from "../useEformsignDocumentJobs";

const DOCUMENT_JOBS_A: EformsignDocumentJobList = {
  active: [{
    jobId: "job-a",
    jobType: "create_document",
    source: "staff",
    status: "processing",
    clientId: null,
    documentId: null,
    progressStep: null,
    attempts: 1,
    nextAttemptAt: "2026-09-29T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  }],
  requiresAttention: [],
  recent: [],
};

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useEformsignDocumentJobsSummary branch scope", () => {
  beforeEach(() => {
    document.cookie = "selected_branch_id=branch-a; path=/";
  });

  afterEach(() => {
    document.cookie = "selected_branch_id=; Max-Age=0; path=/";
    jest.restoreAllMocks();
  });

  it("does not reuse a cached count after the selected branch changes", async () => {
    let resolveBranchB: ((summary: { activeCount: number; requiresAttentionCount: number }) => void) | undefined;
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValueOnce({ activeCount: 3, requiresAttentionCount: 1 })
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveBranchB = resolve;
        }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useEformsignDocumentJobsSummary(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data?.activeCount).toBe(3));
    expect(queryClient.getQueryData(eformsignDocumentJobsQueryKeys.summary("branch-a"))).toEqual({
      activeCount: 3,
      requiresAttentionCount: 1,
    });

    act(() => {
      document.cookie = "selected_branch_id=branch-b; path=/";
      window.dispatchEvent(new Event("pageshow"));
    });

    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(eformsignDocumentJobsQueryKeys.summary("branch-b"))).toBeUndefined();

    await act(async () => {
      resolveBranchB?.({ activeCount: 8, requiresAttentionCount: 0 });
    });
    await waitFor(() => expect(result.current.data?.activeCount).toBe(8));
  });

  it("hides a cached count while the provider session is unauthenticated", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(eformsignDocumentJobsQueryKeys.summary("branch-a"), {
      activeCount: 5,
      requiresAttentionCount: 0,
    });

    const { result } = renderHook(() => useEformsignDocumentJobsSummary(false), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
  });

  it("does not show cached list rows after the selected branch changes", async () => {
    let resolveBranchB: ((jobs: typeof DOCUMENT_JOBS_A) => void) | undefined;
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue({ activeCount: 0, requiresAttentionCount: 0 });
    const getJobs = jest
      .spyOn(eformsignApi, "getDocumentJobs")
      .mockResolvedValueOnce(DOCUMENT_JOBS_A)
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveBranchB = resolve;
        }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => useEformsignDocumentJobs({ isAuthenticated: true, isPopoverOpen: true }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.data?.active[0]?.jobId).toBe("job-a"));
    expect(queryClient.getQueryData(eformsignDocumentJobsQueryKeys.list("branch-a"))).toEqual(DOCUMENT_JOBS_A);
    expect(getSummary).toHaveBeenCalled();

    act(() => {
      document.cookie = "selected_branch_id=branch-b; path=/";
      window.dispatchEvent(new Event("pageshow"));
    });

    await waitFor(() => expect(getJobs).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(eformsignDocumentJobsQueryKeys.list("branch-b"))).toBeUndefined();

    await act(async () => {
      resolveBranchB?.({
        ...DOCUMENT_JOBS_A,
        active: [{ ...DOCUMENT_JOBS_A.active[0], jobId: "job-b" }],
        requiresAttention: [],
        recent: [],
      });
    });
    await waitFor(() => expect(result.current.data?.active[0]?.jobId).toBe("job-b"));
  });
});
