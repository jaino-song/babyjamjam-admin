import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";
import { useEformsignDocumentsByType } from "../useEformsignDocuments";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    getAllDocuments: jest.fn(),
  },
  withEformsignReauth: jest.fn((operation: () => Promise<unknown>) => operation()),
}));

const mockedGetAllDocuments = eformsignApi.getAllDocuments as jest.MockedFunction<
  typeof eformsignApi.getAllDocuments
>;

function documentFixture(id: string, statusType: string): EformsignDocument {
  return {
    id,
    document_number: id,
    template: { id: "template-1", name: "테스트" },
    document_name: id,
    creator: { recipient_type: "01", name: "테스트" },
    created_date: 1,
    last_editor: { recipient_type: "01", name: "테스트" },
    updated_date: 1,
    current_status: {
      status_type: statusType,
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "05",
      step_index: "1",
      step_name: "이용자",
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  };
}

function createWrapper(queryClient: QueryClient) {
  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useEformsignDocumentsByType", () => {
  beforeEach(() => {
    mockedGetAllDocuments.mockReset();
  });

  it("hides deleted status codes without changing the shared semantic category", async () => {
    const response: EformsignDocumentsResponse = {
      documents: [
        documentFixture("deleted-request", "047"),
        documentFixture("deleted", "049"),
        documentFixture("tombstone", "099"),
        documentFixture("withdrawn", "090"),
        documentFixture("expired", "080"),
      ],
      total_rows: 5,
      limit: 20,
      skip: 0,
    };
    mockedGetAllDocuments.mockResolvedValue(response);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useEformsignDocumentsByType(true, null), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.documents.map((document) => document.id)).toEqual([
      "withdrawn",
      "expired",
    ]);
    expect(result.current.data?.total_rows).toBe(2);
  });
});
