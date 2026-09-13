import {
  buildContractServiceInfo,
  resolveContractVoucherYear,
} from "@/lib/contracts/contract-service-info";
import type { EformsignDocument } from "@/lib/eformsign/types";

const CREATED_DATE = new Date("2026-09-09T12:00:00+09:00").getTime();

function documentWithFields(
  fields: unknown[],
  createdDate = CREATED_DATE,
): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-1", name: "계약서" },
    document_name: "계약서",
    creator: { recipient_type: "01", id: "creator", name: "creator" },
    created_date: createdDate,
    last_editor: { recipient_type: "01", id: "editor", name: "editor" },
    updated_date: 0,
    current_status: {
      status_type: "003",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "01",
      step_index: "3",
      step_name: "완료",
      step_recipients: [],
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

describe("buildContractServiceInfo", () => {
  it("builds the service and pricing rows from eformsign fields", () => {
    const doc = documentWithFields([
      { id: "서비스 기간", value: "2026.09.09 ~ 2026.10.01" },
      { id: "서비스 일수", value: "15일" },
      { id: "서비스 시작일", value: "2026-09-09" },
      { id: "서비스 종료일", value: "2026-10-01" },
      { id: "본인부담금 수령일", value: "2026-09-03" },
      { id: "영수증 발행일", value: "2026-09-09" },
      { id: "서비스 비용", value: "2,196,000원" },
      { id: "정부지원금", value: "1,303,000원" },
      { id: "본인부담금", value: "893,000원" },
      { id: "계약 시작 년도", value: "2026" },
    ]);

    expect(buildContractServiceInfo(doc)).toEqual({
      contractPeriod: "2026.09.09 ~ 2026.10.01",
      serviceDays: "15일",
      contractStartDate: "2026.09.09",
      contractEndDate: "2026.10.01",
      paymentReceiptDate: "2026.09.03",
      receiptIssueDate: "2026.09.09",
      servicePrice: "2,196,000원",
      governmentGrant: "1,303,000원",
      outOfPocket: "893,000원",
      voucherPriceYearLabel: "2026년",
    });
  });

  it("assembles dates from split year/month/day fields and the period fallback", () => {
    const doc = documentWithFields([
      { id: "startYear", value: "26" },
      { id: "startMonth", value: "9" },
      { id: "startDay", value: "9" },
      { id: "endYear", value: "26" },
      { id: "endMonth", value: "10" },
      { id: "endDay", value: "1" },
    ]);

    expect(buildContractServiceInfo(doc)).toMatchObject({
      contractPeriod: "2026.09.09 ~ 2026.10.01",
      contractStartDate: "2026.09.09",
      contractEndDate: "2026.10.01",
    });
  });

  it("keeps the exact price field when a receipt-date field matches a partial alias", () => {
    const doc = documentWithFields([
      { id: "본인부담금 수령일", value: "2026-09-03" },
      { id: "본인부담금", value: "893,000원" },
    ]);

    expect(buildContractServiceInfo(doc)).toMatchObject({
      paymentReceiptDate: "2026.09.03",
      outOfPocket: "893,000원",
    });
  });

  it("infers service days from voucher price amounts when no days field exists", () => {
    const doc = documentWithFields([
      { id: "서비스 비용", value: "2,196,000원" },
      { id: "정부지원금", value: "1,303,000원" },
      { id: "본인부담금", value: "893,000원" },
    ]);

    expect(
      buildContractServiceInfo(doc, [
        { duration: "15", fullPrice: "2196000", grant: "1303000", actualPrice: "893000" },
      ]).serviceDays,
    ).toBe("15일");
  });

  it("falls back to the document creation date for missing receipt fields and the voucher year", () => {
    const doc = documentWithFields([]);

    expect(buildContractServiceInfo(doc)).toEqual({
      contractPeriod: "-",
      serviceDays: "-",
      contractStartDate: "-",
      contractEndDate: "-",
      paymentReceiptDate: "-",
      receiptIssueDate: "2026.09.09",
      servicePrice: "-",
      governmentGrant: "-",
      outOfPocket: "-",
      voucherPriceYearLabel: "2026년",
    });
  });
});

describe("resolveContractVoucherYear", () => {
  it("reads a two-digit contract start year as a 2000s year", () => {
    const doc = documentWithFields([{ id: "계약 시작 년도", value: "25" }]);
    expect(resolveContractVoucherYear(doc)).toBe(2025);
  });

  it("falls back to the document creation year", () => {
    const doc = documentWithFields([], new Date("2025-03-01T12:00:00+09:00").getTime());
    expect(resolveContractVoucherYear(doc)).toBe(2025);
  });
});
