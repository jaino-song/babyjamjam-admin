import { QueryClient } from "@tanstack/react-query";
import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  applyEformsignDocumentToCaches,
  applyWebhookUpdateToDocument,
} from "@/lib/eformsign/live-updates";

function createDocument(
  id: string,
  statusType: string,
  createdDate: number
): EformsignDocument {
  return {
    id,
    document_number: `DOC-${id}`,
    template: { id: "template-1", name: "템플릿" },
    document_name: "산모신생아건강관리서비스 계약서",
    creator: { recipient_type: "02", id: "creator", name: "관리자" },
    created_date: createdDate,
    last_editor: { recipient_type: "02", id: "editor", name: "관리자" },
    updated_date: createdDate,
    current_status: {
      status_type: statusType,
      status_doc_type: "doc",
      status_doc_detail: "detail",
      step_type: "05",
      step_index: "2",
      step_name: "참여자",
      step_recipients: [{ recipient_type: "02", name: `${id}-수신자` }],
      step_group: 1,
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

describe("applyEformsignDocumentToCaches", () => {
  it("updates only the target document while preserving unaffected references", () => {
    const queryClient = new QueryClient();
    const firstDocument = createDocument("doc-1", "060", 200);
    const secondDocument = createDocument("doc-2", "060", 100);

    queryClient.setQueryData(["eformsign-documents", "all"], {
      documents: [firstDocument, secondDocument],
      total_rows: 2,
      limit: 100,
      skip: 0,
    });
    queryClient.setQueryData(["eformsign-documents", "client-paginated", "all"], {
      documents: [firstDocument, secondDocument],
      total_rows: 2,
      limit: 100,
      skip: 0,
    });
    queryClient.setQueryData(["eformsign-documents", "in-progress"], {
      documents: [firstDocument, secondDocument],
      total_rows: 2,
      limit: 100,
      skip: 0,
    });

    const updatedDocument = applyWebhookUpdateToDocument(firstDocument, {
      documentId: "doc-1",
      statusType: "003",
      statusDetail: "completed",
      stepType: "05",
      stepIndex: "2",
      stepName: "참여자",
      expiredDate: null,
      receivedAt: 300,
      raw: {},
    });

    applyEformsignDocumentToCaches(queryClient, updatedDocument);

    const allDocuments = queryClient.getQueryData<{
      documents: EformsignDocument[];
    }>(["eformsign-documents", "all"]);
    const paginatedDocuments = queryClient.getQueryData<{
      documents: EformsignDocument[];
    }>(["eformsign-documents", "client-paginated", "all"]);
    const inProgressDocuments = queryClient.getQueryData<{
      documents: EformsignDocument[];
    }>(["eformsign-documents", "in-progress"]);

    expect(allDocuments?.documents[0]).toMatchObject({
      id: "doc-1",
      current_status: expect.objectContaining({
        status_type: "003",
      }),
    });
    expect(allDocuments?.documents[1]).toBe(secondDocument);

    expect(paginatedDocuments?.documents[0]).toMatchObject({
      id: "doc-1",
      current_status: expect.objectContaining({
        status_type: "003",
      }),
    });
    expect(paginatedDocuments?.documents[1]).toBe(secondDocument);

    expect(inProgressDocuments?.documents).toHaveLength(1);
    expect(inProgressDocuments?.documents[0]).toMatchObject({
      id: "doc-2",
      current_status: expect.objectContaining({
        status_type: "060",
      }),
    });
  });
});
