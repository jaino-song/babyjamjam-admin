import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";
import type { EformsignDocumentsResponse } from "@babyjamjam/shared/types/eformsign";
import { infiniteContractsQueryKeys, useInfiniteContracts } from "../useInfiniteContracts";

jest.mock("@/services/api", () => ({
  eformsignApi: { getAllDocuments: jest.fn() },
}));

function page(skip: number, snapshot: string): EformsignDocumentsResponse {
  return {
    documents: Array.from({ length: 20 }, (_, index) => ({
      id: `document-${skip + index}`,
      document_name: `Contract ${skip + index}`,
      created_date: 100 - skip - index,
      document_number: `${skip + index}`,
      template: { id: "template", name: "Contract" },
      creator: { recipient_type: "01", name: "Test" },
      last_editor: { recipient_type: "01", name: "Test" },
      updated_date: 100,
      current_status: {
        status_type: "060", status_doc_type: "", status_doc_detail: "",
        step_type: "", step_index: "", step_name: "", step_recipients: [],
        step_group: 0, expired_date: 0, _expired: false,
      },
      fields: [], next_status: [], previous_status: [], histories: [],
      recipients: [], detail_template_info: [],
    })),
    skip,
    limit: 20,
    total_rows: 40,
    snapshot_version: snapshot,
  };
}

describe("useInfiniteContracts pagination during live refresh", () => {
  it("preserves an in-flight refresh before appending the next page", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const api = jest.mocked(eformsignApi.getAllDocuments);
    let finishRefresh!: (value: EformsignDocumentsResponse) => void;
    const refresh = new Promise<EformsignDocumentsResponse>((resolve) => {
      finishRefresh = resolve;
    });
    api.mockReset();
    api.mockResolvedValueOnce(page(0, "old"))
      .mockReturnValueOnce(refresh)
      .mockResolvedValue(page(20, "new"));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () => useInfiniteContracts({ section: "maternity" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.documents).toHaveLength(20));

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = queryClient.invalidateQueries({
        queryKey: infiniteContractsQueryKeys.documents(null, "maternity", ""),
      });
    });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    act(() => { void result.current.fetchNextPage(); });
    expect(api).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishRefresh(page(0, "new"));
      await refreshing;
    });
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.documents).toHaveLength(40));
    expect(api.mock.calls.map(([params]) => params?.skip)).toEqual([0, 0, 20]);
    unmount();
    queryClient.clear();
  });
});
