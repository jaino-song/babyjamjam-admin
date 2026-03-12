import { extractEformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

describe("extractEformsignWebhookDocumentUpdate", () => {
  it("extracts the document id and status from nested payloads", () => {
    const update = extractEformsignWebhookDocumentUpdate({
      event_name: "document.status.changed",
      document: {
        document_id: "doc-123",
        current_status: {
          status_type: "doc_complete",
          status_doc_detail: "completed",
          step_type: "05",
          step_index: "2",
          step_name: "참여자",
          expired_date: 1730000000000,
        },
      },
    });

    expect(update).not.toBeNull();
    expect(update).toMatchObject({
      documentId: "doc-123",
      statusType: "003",
      statusDetail: "completed",
      stepType: "05",
      stepIndex: "2",
      stepName: "참여자",
      expiredDate: 1730000000000,
    });
  });

  it("falls back to a generic id only when the record looks document-shaped", () => {
    const update = extractEformsignWebhookDocumentUpdate({
      payload: {
        id: "doc-generic",
        document_name: "산모신생아건강관리서비스 계약서",
        status: "doc_request_participant",
      },
      actor: {
        id: "user-1",
      },
    });

    expect(update).not.toBeNull();
    expect(update).toMatchObject({
      documentId: "doc-generic",
      statusType: "060",
    });
  });

  it("returns null for payloads without a recognizable document id", () => {
    expect(
      extractEformsignWebhookDocumentUpdate({
        event_name: "document.status.changed",
        actor: { id: "user-1", status: "doc_complete" },
      })
    ).toBeNull();
  });
});
