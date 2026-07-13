import { buildClientEditPrefillFromEformsignDocument } from "../client-prefill";
import type { EformsignDocument } from "../types";

function documentWithFields(fields: unknown[]): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-1", name: "계약서" },
    document_name: "계약서",
    creator: { recipient_type: "01", id: "creator", name: "creator" },
    created_date: 0,
    last_editor: { recipient_type: "01", id: "editor", name: "editor" },
    updated_date: 0,
    current_status: {
      status_type: "003",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "01",
      step_index: "3",
      step_name: "완료",
      step_recipients: [{ recipient_type: "05", name: "김관리", sms: "01011112222" }],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields,
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  };
}

describe("buildClientEditPrefillFromEformsignDocument", () => {
  it("extracts client service settings from eformsign fields", () => {
    const doc = documentWithFields([
      { id: "바우처 유형", value: "A통합-3형" },
      { id: "서비스 기간", value: "15일" },
      { id: "총 서비스 금액", value: "2,848,000원" },
      { id: "정부지원금", value: "1,481,000원" },
      { id: "본인부담금", value: "1,367,000원" },
      { id: "서비스 시작일", value: "2026-06-03" },
      { id: "서비스 종료일", value: "2026-06-23" },
      { id: "제공인력 1 성명", value: "김관리" },
    ]);

    expect(buildClientEditPrefillFromEformsignDocument(doc)).toMatchObject({
      type: "A통합-3형",
      duration: 15,
      fullPrice: "2848000",
      grant: "1481000",
      actualPrice: "1367000",
      startDate: "260603",
      endDate: "260623",
      primaryEmployeeName: "김관리",
      primaryEmployeePhone: "010-1111-2222",
    });
  });

  it("extracts dates from split year month day fields", () => {
    const doc = documentWithFields([
      { id: "startYear", value: "2026" },
      { id: "startMonth", value: "6" },
      { id: "startDay", value: "3" },
    ]);

    expect(buildClientEditPrefillFromEformsignDocument(doc).startDate).toBe("260603");
  });

  it("does not treat voucher type digits as service duration", () => {
    const doc = documentWithFields([
      { id: "바우처 유형", value: "A통합-1형" },
      { id: "기간", value: "1" },
    ]);

    expect(buildClientEditPrefillFromEformsignDocument(doc)).toMatchObject({
      type: "A통합-1형",
    });
    expect(buildClientEditPrefillFromEformsignDocument(doc).duration).toBeUndefined();
  });

  it("extracts provider names from document aliases used in contract detail", () => {
    const doc = documentWithFields([
      { id: "제공인력명", value: "김정인" },
      { id: "제공자 연락처", value: "01012345678" },
    ]);

    expect(buildClientEditPrefillFromEformsignDocument(doc)).toMatchObject({
      primaryEmployeeName: "김정인",
      primaryEmployeePhone: "010-1234-5678",
    });
  });
});
