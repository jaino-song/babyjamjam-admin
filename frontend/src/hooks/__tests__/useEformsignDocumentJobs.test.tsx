import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";

import {
  eformsignDocumentJobsQueryKeys,
  useEformsignDocumentJobsSummary,
} from "../useEformsignDocumentJobs";

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
});
