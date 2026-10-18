import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";
import type { EformsignDocumentsResponse } from "@babyjamjam/shared/types/eformsign";

import { useInfiniteContracts } from "../useInfiniteContracts";

jest.mock("@/services/api", () => ({ eformsignApi: { getAllDocuments: jest.fn() } }));

const firstPage: EformsignDocumentsResponse = {
  documents: [{
    id: "cached", document_name: "Cached", document_number: "1",
    created_date: 100, updated_date: 100,
    template: { id: "template", name: "Contract" },
    creator: { recipient_type: "01", name: "Test" },
    last_editor: { recipient_type: "01", name: "Test" },
    current_status: {
      status_type: "060", status_doc_type: "", status_doc_detail: "",
      step_type: "", step_index: "", step_name: "", step_recipients: [],
      step_group: 0, expired_date: 0, _expired: false,
    },
    fields: [], next_status: [], previous_status: [], histories: [],
    recipients: [], detail_template_info: [],
  }],
  skip: 0, limit: 20, total_rows: 40,
};

function renderContracts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useInfiniteContracts(), { wrapper }), client };
}

beforeEach(() => jest.mocked(eformsignApi.getAllDocuments).mockReset());

it("exposes initial error and clears it after a successful retry", async () => {
  jest.mocked(eformsignApi.getAllDocuments).mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce(firstPage);
  const { result, unmount, client } = renderContracts();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.isRefetching).toBe(false);
  expect(result.current.isFetchNextPageError).toBe(false);
  expect(result.current.documents).toEqual([]);
  await act(async () => { await result.current.refetch(); });
  await waitFor(() => expect(result.current.isError).toBe(false));
  expect(result.current.documents).toHaveLength(1);
  unmount();
  client.clear();
});

it("exposes in-flight refetch and a failed next page without dropping cached rows", async () => {
  const api = jest.mocked(eformsignApi.getAllDocuments);
  api.mockResolvedValueOnce(firstPage);
  const { result, unmount, client } = renderContracts();
  await waitFor(() => expect(result.current.documents).toHaveLength(1));
  expect(result.current.isError).toBe(false);
  expect(result.current.isRefetching).toBe(false);
  expect(result.current.isFetchNextPageError).toBe(false);

  let rejectRefresh!: (error: Error) => void;
  api.mockReturnValueOnce(new Promise((_, reject) => { rejectRefresh = reject; }));
  let refresh!: ReturnType<typeof result.current.refetch>;
  act(() => { refresh = result.current.refetch(); });
  await waitFor(() => expect(result.current.isRefetching).toBe(true));
  await act(async () => { rejectRefresh(new Error("refresh failed")); await refresh; });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.isRefetching).toBe(false);
  expect(result.current.isFetchNextPageError).toBe(false);
  expect(result.current.documents).toHaveLength(1);

  api.mockRejectedValueOnce(new Error("next page failed"));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
  expect(result.current.isError).toBe(true);
  expect(result.current.documents).toHaveLength(1);
  expect(result.current.hasNextPage).toBe(true);

  api.mockResolvedValueOnce({ documents: [], skip: 20, limit: 20, total_rows: 20 });
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.isFetchNextPageError).toBe(false));
  expect(result.current.isError).toBe(false);
  expect(result.current.documents).toHaveLength(1);
  unmount();
  client.clear();
});
