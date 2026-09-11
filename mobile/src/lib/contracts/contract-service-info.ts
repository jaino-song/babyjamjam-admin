import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { documentFieldValueExact } from "@/lib/eformsign/client-prefill";
import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  inferVoucherDurationFromAmounts,
  type VoucherPriceInfoLike,
} from "@/lib/voucher/duration";

const DASH = "-";

export interface ContractServiceInfo {
  contractPeriod: string;
  serviceDays: string;
  contractStartDate: string;
  contractEndDate: string;
  paymentReceiptDate: string;
  receiptIssueDate: string;
  servicePrice: string;
  governmentGrant: string;
  outOfPocket: string;
  voucherPriceYearLabel: string;
}

type FieldDocument = Pick<EformsignDocument, "fields" | "detail_template_info">;
type FieldDateParts = { year: readonly string[]; month: readonly string[]; day: readonly string[] };

// Aliases mirror the desktop contract detail service cards so both platforms
// display the same values for the same eformsign document.
const SERVICE_PERIOD_FIELD_IDS = [
  "서비스 기간",
  "서비스기간",
  "바우처 기간",
  "바우처기간",
  "계약 기간",
  "계약기간",
  "서비스 일수",
  "서비스일수",
  "일수",
  "days",
  "duration",
  "contractDuration",
] as const;

const CONTRACT_START_DATE_FIELD_IDS = [
  "계약 시작일",
  "계약시작일",
  "서비스 시작일",
  "서비스시작일",
  "startDate",
] as const;
const CONTRACT_START_DATE_PART_IDS: FieldDateParts = {
  year: ["계약 시작 년도", "계약시작년도", "계약 시작 연도", "계약시작연도", "startYear"],
  month: ["계약 시작 월", "계약시작월", "startMonth"],
  day: ["계약 시작 일", "계약시작일", "startDay"],
};

const CONTRACT_END_DATE_FIELD_IDS = [
  "계약 종료일",
  "계약종료일",
  "서비스 종료일",
  "서비스종료일",
  "endDate",
] as const;
const CONTRACT_END_DATE_PART_IDS: FieldDateParts = {
  year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "endYear"],
  month: ["계약 종료 월", "계약종료월", "endMonth"],
  day: ["계약 종료 일", "계약종료일", "endDay"],
};

const PAYMENT_RECEIPT_DATE_FIELD_IDS = [
  "본인부담금 수령일",
  "본인부담금수령일",
  "본인부담금 수령 날짜",
  "본인부담금수령날짜",
  "결제일",
  "paymentDate",
] as const;
const PAYMENT_RECEIPT_DATE_PART_IDS: FieldDateParts = {
  year: ["본인부담금 수령 년도", "본인부담금수령년도", "결제 년도", "결제년도", "paymentYear"],
  month: ["본인부담금 수령 월", "본인부담금수령월", "결제 월", "결제월", "paymentMonth"],
  day: ["본인부담금 수령 일", "본인부담금수령일", "결제 일", "결제일", "paymentDay"],
};

const RECEIPT_ISSUE_DATE_FIELD_IDS = [
  "영수증 발행일",
  "영수증발행일",
  "영수증 날짜",
  "영수증날짜",
  "receiptDate",
] as const;
const RECEIPT_ISSUE_DATE_PART_IDS: FieldDateParts = {
  year: ["영수증 년도", "영수증년도", "영수증 발행 년도", "영수증발행년도", "receiptYear"],
  month: ["영수증 월", "영수증월", "영수증 발행 월", "영수증발행월", "receiptMonth"],
  day: ["영수증 일", "영수증일", "영수증 발행 일", "영수증발행일", "receiptDay"],
};

const SERVICE_PRICE_FIELD_IDS = [
  "총 서비스 금액",
  "총서비스금액",
  "서비스 비용",
  "서비스비용",
  "서비스 가격",
  "서비스가격",
  "서비스 총액",
  "서비스총액",
  "총액",
  "fullPrice",
] as const;
const GOVERNMENT_GRANT_FIELD_IDS = ["정부지원금", "지원금", "grant"] as const;
const OUT_OF_POCKET_FIELD_IDS = ["본인부담금", "실결제금액", "actualPrice"] as const;

const VOUCHER_YEAR_FIELD_IDS = [
  "계약 시작 년도",
  "계약시작년도",
  "계약 시작 연도",
  "계약시작연도",
  "startYear",
  "voucherYear",
  "receiptYear",
] as const;

const DATE_PART_PATTERN =
  /^(\d{2,4})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?\.?$/;

function digitsOnly(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeDateDigits(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.length === 6) return digits;
  if (digits.length >= 8) {
    return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  }
  return null;
}

function twoDigitPart(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  return digits ? digits.slice(-2).padStart(2, "0") : null;
}

function fourDigitYear(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.length >= 4) return digits.slice(0, 4);
  if (digits.length === 2) return `20${digits}`;
  return null;
}

function toDisplayDate(yymmdd: string): string {
  return formatDateForDisplay(
    `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
  );
}

function extractDisplayDate(
  doc: FieldDocument,
  fieldIds: readonly string[],
  parts?: FieldDateParts,
): string | null {
  const direct = normalizeDateDigits(documentFieldValueExact(doc, fieldIds));
  if (direct) {
    return toDisplayDate(direct);
  }
  if (!parts) {
    return null;
  }

  const year = twoDigitPart(fourDigitYear(documentFieldValueExact(doc, parts.year)));
  const month = twoDigitPart(documentFieldValueExact(doc, parts.month));
  const day = twoDigitPart(documentFieldValueExact(doc, parts.day));
  if (!year || !month || !day) {
    return null;
  }

  return toDisplayDate(`${year}${month}${day}`);
}

function servicePeriodValues(doc: FieldDocument): string[] {
  const values = new Set<string>();
  for (const fieldId of SERVICE_PERIOD_FIELD_IDS) {
    const value = documentFieldValueExact(doc, [fieldId]);
    if (value) {
      values.add(value);
    }
  }
  return [...values];
}

function formatRangePart(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(DATE_PART_PATTERN);
  if (!match) {
    return trimmed;
  }

  const [, year, month, day] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return formatDateForDisplay(
    `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
}

function formatRangeValue(range: string): string {
  const parts = range.includes("~") ? range.split(/\s*~\s*/) : range.split(/\s+-\s+/);
  if (parts.length !== 2) {
    return range.trim();
  }
  return `${formatRangePart(parts[0])} ~ ${formatRangePart(parts[1])}`;
}

function parseServiceDays(value: string): string | null {
  const match = value.trim().match(/^(\d+)일?$/);
  return match ? `${match[1]}일` : null;
}

function formatWon(value: string | null): string {
  if (!value) {
    return DASH;
  }

  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return value;
  }

  return `${Number(digits).toLocaleString("ko-KR")}원`;
}

export function resolveContractVoucherYear(
  doc: Pick<EformsignDocument, "fields" | "detail_template_info" | "created_date">,
): number {
  const raw = documentFieldValueExact(doc, VOUCHER_YEAR_FIELD_IDS);
  const digits = raw?.replace(/[^\d]/g, "") ?? "";
  if (digits) {
    const normalized = digits.length === 2 ? `20${digits}` : digits.slice(0, 4);
    const year = Number(normalized);
    if (Number.isInteger(year) && year >= 2000 && year <= 2999) {
      return year;
    }
  }

  const createdYear = Number(formatDateForDisplay(doc.created_date).slice(0, 4));
  return Number.isInteger(createdYear) && createdYear >= 2000
    ? createdYear
    : new Date().getFullYear();
}

export function buildContractServiceInfo(
  doc: EformsignDocument,
  voucherPriceInfos?: readonly VoucherPriceInfoLike[] | null,
): ContractServiceInfo {
  const servicePriceValue = documentFieldValueExact(doc, SERVICE_PRICE_FIELD_IDS);
  const governmentGrantValue = documentFieldValueExact(doc, GOVERNMENT_GRANT_FIELD_IDS);
  const outOfPocketValue = documentFieldValueExact(doc, OUT_OF_POCKET_FIELD_IDS);

  const contractStartDate = extractDisplayDate(
    doc,
    CONTRACT_START_DATE_FIELD_IDS,
    CONTRACT_START_DATE_PART_IDS,
  );
  const contractEndDate = extractDisplayDate(
    doc,
    CONTRACT_END_DATE_FIELD_IDS,
    CONTRACT_END_DATE_PART_IDS,
  );
  const paymentReceiptDate = extractDisplayDate(
    doc,
    PAYMENT_RECEIPT_DATE_FIELD_IDS,
    PAYMENT_RECEIPT_DATE_PART_IDS,
  );
  const receiptIssueDate = extractDisplayDate(
    doc,
    RECEIPT_ISSUE_DATE_FIELD_IDS,
    RECEIPT_ISSUE_DATE_PART_IDS,
  );

  const periodValues = servicePeriodValues(doc);
  const rangeValue =
    periodValues.find((value) => value.includes("~")) ??
    periodValues.find((value) => /\s-\s/.test(value));
  const contractPeriod = rangeValue
    ? formatRangeValue(rangeValue)
    : contractStartDate && contractEndDate
      ? `${contractStartDate} ~ ${contractEndDate}`
      : DASH;

  const directServiceDays = periodValues
    .map((value) => parseServiceDays(value))
    .find((value): value is string => Boolean(value));
  const inferredServiceDays = voucherPriceInfos
    ? inferVoucherDurationFromAmounts(voucherPriceInfos, {
        fullPrice: servicePriceValue,
        grant: governmentGrantValue,
        actualPrice: outOfPocketValue,
      })
    : null;
  const serviceDays =
    directServiceDays ?? (inferredServiceDays ? `${inferredServiceDays}일` : DASH);

  return {
    contractPeriod,
    serviceDays,
    contractStartDate: contractStartDate ?? DASH,
    contractEndDate: contractEndDate ?? DASH,
    paymentReceiptDate: paymentReceiptDate ?? DASH,
    // Contract creation currently stamps receipt fields with the document
    // generation date, so a missing receipt field falls back to created_date.
    receiptIssueDate: receiptIssueDate ?? formatDateForDisplay(doc.created_date),
    servicePrice: formatWon(servicePriceValue),
    governmentGrant: formatWon(governmentGrantValue),
    outOfPocket: formatWon(outOfPocketValue),
    voucherPriceYearLabel: `${resolveContractVoucherYear(doc)}년`,
  };
}
