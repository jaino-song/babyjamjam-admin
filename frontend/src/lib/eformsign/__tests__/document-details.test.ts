import {
  extractDocumentAddress,
  extractDocumentContactInfo,
  extractDocumentFieldValue,
  extractDocumentFieldValues,
  extractOpenEvents,
  extractReRequestEvents,
} from "@/lib/eformsign/document-details";
import type { EformsignDocument } from "@/lib/eformsign/types";

function createDocument(overrides: Partial<EformsignDocument> = {}): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "DOC-001",
    template: { id: "tpl-1", name: "Template" },
    document_name: "산모신생아건강관리서비스 계약서",
    creator: { recipient_type: "01", id: "creator@test.com", name: "관리자" },
    created_date: 1_760_000_000_000,
    last_editor: { recipient_type: "01", id: "editor@test.com", name: "관리자" },
    updated_date: 1_760_000_100_000,
    current_status: {
      status_type: "060",
      status_doc_type: "doc",
      status_doc_detail: "detail",
      step_type: "05",
      step_index: "2",
      step_name: "서명 요청",
      step_recipients: [{ recipient_type: "02", name: "김예지", sms: "01012341234" }],
      step_group: 1,
      expired_date: 1_760_100_000_000,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
    ...overrides,
  };
}

describe("document detail helpers", () => {
  it("extracts address from the document fields", () => {
    const document = createDocument({
      fields: [
        { id: "이용자 성명", value: "김예지", type: "text" },
        { id: "이용자 주소", value: "인천광역시 남동구 구월남로 120", type: "text" },
      ],
    });

    expect(extractDocumentAddress(document)).toBe("인천광역시 남동구 구월남로 120");
  });

  it("extracts a field value by alias from the document fields", () => {
    const document = createDocument({
      fields: [
        { id: "제공인력 1 성명", value: "박수현", type: "text" },
        { id: "제공인력 1 연락처", value: "01012345678", type: "text" },
      ],
    });

    expect(extractDocumentFieldValue(document, ["제공인력1성명", "provider1name"])).toBe("박수현");
  });

  it("extracts multiple matching field values while preserving order", () => {
    const document = createDocument({
      fields: [
        { id: "서비스 기간", value: "15일", type: "text" },
        { id: "서비스 기간", value: "2026-03-10 ~ 2026-03-24", type: "text" },
      ],
    });

    expect(extractDocumentFieldValues(document, ["서비스 기간"])).toEqual([
      "15일",
      "2026-03-10 ~ 2026-03-24",
    ]);
  });

  it("extracts inline keyed field values from detail_template_info", () => {
    const document = createDocument({
      detail_template_info: [
        {
          sections: [
            {
              제공인력2성명: "이수민",
              제공인력2연락처: "01098765432",
            },
          ],
        },
      ],
    });

    expect(extractDocumentFieldValue(document, ["제공인력 2 성명", "제공인력2성명"])).toBe("이수민");
    expect(extractDocumentFieldValue(document, ["제공인력 2 연락처", "제공인력2연락처"])).toBe("01098765432");
  });

  it("extracts contact info from document fields when recipient metadata is incomplete", () => {
    const document = createDocument({
      fields: [
        { id: "이메일", value: "client@test.com", type: "text" },
      ],
    });

    expect(extractDocumentContactInfo(document)).toEqual({
      phone: "01012341234",
      email: "client@test.com",
    });
  });

  it("prefers customer contact fields over the current workflow recipient", () => {
    const document = createDocument({
      current_status: {
        ...createDocument().current_status,
        step_recipients: [
          { recipient_type: "01", name: "제공기관", sms: "01099998888" },
        ],
      },
      fields: [
        { id: "이용자 연락처", value: "01011112222", type: "text" },
        { id: "이용자 이메일", value: "client@test.com", type: "text" },
      ],
    });

    expect(extractDocumentContactInfo(document)).toEqual({
      phone: "01011112222",
      email: "client@test.com",
    });
  });

  it("extracts a re-request event from histories with status code 063", () => {
    const timestamp = 1_760_000_555_000;
    const document = createDocument({
      histories: [
        {
          status_type: "063",
          updated_date: timestamp,
          comment: "재요청입니다.",
        },
      ],
    });

    expect(extractReRequestEvents(document)).toEqual([{ timestamp }]);
  });

  it("falls back to the current status when the document is currently in re-request state", () => {
    const timestamp = 1_760_000_888_000;
    const document = createDocument({
      updated_date: timestamp,
      current_status: {
        ...createDocument().current_status,
        status_type: "063",
      },
    });

    expect(extractReRequestEvents(document)).toEqual([{ timestamp }]);
  });

  it("extracts an open event from histories with status code 064", () => {
    const timestamp = 1_760_000_777_000;
    const document = createDocument({
      histories: [
        {
          action_type: "064",
          created_date: timestamp,
        },
      ],
    });

    expect(extractOpenEvents(document)).toEqual([{ timestamp }]);
  });

  it("falls back to the current status when the document is currently in open state", () => {
    const timestamp = 1_760_000_999_000;
    const document = createDocument({
      updated_date: timestamp,
      current_status: {
        ...createDocument().current_status,
        status_type: "064",
      },
    });

    expect(extractOpenEvents(document)).toEqual([{ timestamp }]);
  });
});
