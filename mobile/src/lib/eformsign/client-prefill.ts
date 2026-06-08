import type { EformsignDocument } from "@/lib/eformsign/types";

type UnknownRecord = Record<string, unknown>;

export interface EformsignClientEditPrefill {
  name?: string;
  phone?: string;
  birthday?: string;
  dueDate?: string;
  address?: string;
  type?: string;
  duration?: number;
  fullPrice?: string;
  grant?: string;
  actualPrice?: string;
  startDate?: string;
  endDate?: string;
  primaryEmployeeName?: string;
  primaryEmployeePhone?: string;
  secondaryEmployeeName?: string;
  secondaryEmployeePhone?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
  ];
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
  const valueKeys = ["value", "field_value", "fieldValue", "data", "text"] as const;
  for (const key of valueKeys) {
    const value = stringFromUnknown(record[key]);
    if (value) return value;
  }

  for (const nested of collectRecords(record).slice(1)) {
    for (const key of valueKeys) {
      const value = stringFromUnknown(nested[key]);
      if (value) return value;
    }
  }

  return null;
}

function documentFieldValue(doc: EformsignDocument, fieldIds: readonly string[]): string | null {
  const normalizeFieldId = (value: string) => value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
  const canUseReverseContains = (value: string) => /^[a-z0-9]+$/.test(value) && value.length >= 5;
  const normalizedIds = fieldIds.map(normalizeFieldId);

  for (const record of collectRecords(doc.fields)) {
    const idTokens = [
      stringFromUnknown(record.id),
      stringFromUnknown(record.field_id),
      stringFromUnknown(record.fieldId),
      stringFromUnknown(record.name),
      stringFromUnknown(record.label),
      stringFromUnknown(record.field_name),
      stringFromUnknown(record.fieldName),
      stringFromUnknown(record.display_name),
      stringFromUnknown(record.displayName),
      stringFromUnknown(record.input_id),
      stringFromUnknown(record.inputId),
    ].filter((value): value is string => Boolean(value));

    if (idTokens.some((token) => {
      const normalizedToken = normalizeFieldId(token);
      return normalizedIds.some(
        (id) =>
          normalizedToken === id ||
          normalizedToken.includes(id) ||
          (canUseReverseContains(normalizedToken) && id.includes(normalizedToken)),
      );
    })) {
      const value = valueFromFieldRecord(record);
      if (value) return value;
    }
  }

  return null;
}

function numericText(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeDateToYymmdd(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length >= 8) return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  return null;
}

function fourDigitYear(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(0, 4);
  if (digits.length === 2) return `20${digits}`;
  return null;
}

function twoDigitPart(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-2).padStart(2, "0");
}

function documentDateToYymmdd(
  doc: EformsignDocument,
  fieldIds: readonly string[],
  parts?: { year: readonly string[]; month: readonly string[]; day: readonly string[] },
): string | null {
  const direct = normalizeDateToYymmdd(documentFieldValue(doc, fieldIds));
  if (direct || !parts) return direct;

  const year = fourDigitYear(documentFieldValue(doc, parts.year));
  const month = twoDigitPart(documentFieldValue(doc, parts.month));
  const day = twoDigitPart(documentFieldValue(doc, parts.day));
  if (!year || !month || !day) return null;

  return `${year.slice(2)}${month}${day}`;
}

function parseDuration(value: string | null | undefined): number | undefined {
  const digits = numericText(value);
  if (!digits) return undefined;
  const duration = Number(digits);
  return Number.isFinite(duration) && duration >= 5 ? duration : undefined;
}

function formatPhone(value: string | null | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return undefined;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function firstValue(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function recipientPhoneByName(doc: EformsignDocument, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const recipient = doc.current_status?.step_recipients?.find((item) => item.name?.trim() === name && item.sms?.trim());
  return formatPhone(recipient?.sms);
}

export function buildClientEditPrefillFromEformsignDocument(
  doc: EformsignDocument,
): EformsignClientEditPrefill {
  const name = documentFieldValue(doc, ["이용자 성명", "고객명", "성명", "customerName", "name"]);
  const primaryEmployeeName = firstValue(
    documentFieldValue(doc, [
      "제공인력 1 성명",
      "제공인력1성명",
      "제공인력 성명",
      "제공인력명",
      "제공인력",
      "관리사 성명",
      "관리사",
      "산후관리사 성명",
      "제공자 성명",
      "caretaker1Name",
      "caretakerName",
      "employeeName",
      "providerName",
    ]),
  );
  const secondaryEmployeeName = firstValue(
    documentFieldValue(doc, [
      "제공인력 2 성명",
      "제공인력2성명",
      "보조 제공인력 성명",
      "보조관리사 성명",
      "caretaker2Name",
      "secondaryEmployeeName",
    ]),
  );
  const prefill: EformsignClientEditPrefill = {};
  const duration = parseDuration(
    documentFieldValue(doc, [
      "바우처 기간",
      "바우처기간",
      "서비스 기간",
      "서비스기간",
      "서비스 일수",
      "서비스일수",
      "기간",
      "일수",
      "days",
      "duration",
      "contractDuration",
    ]),
  );

  const values = {
    name,
    phone: formatPhone(documentFieldValue(doc, ["이용자 연락처", "연락처", "휴대폰", "전화번호", "customerContact", "customerPhone"])),
    birthday: normalizeDateToYymmdd(
      documentFieldValue(doc, ["이용자 생년월일", "생년월일", "주민번호 앞자리", "customerDOB", "customerBirthDate", "birthday"]),
    ),
    dueDate: normalizeDateToYymmdd(documentFieldValue(doc, ["출산 예정일", "출산예정일", "dueDate", "expectedBirthDate"])),
    address: documentFieldValue(doc, ["이용자 주소", "주소", "customerAddress", "address"]),
    type: documentFieldValue(doc, [
      "바우처 유형",
      "바우처유형",
      "유형",
      "서비스 유형",
      "서비스유형",
      "type",
      "serviceType",
    ]),
    duration,
    fullPrice: numericText(documentFieldValue(doc, [
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
    ])),
    grant: numericText(documentFieldValue(doc, ["정부지원금", "지원금", "grant"])),
    actualPrice: numericText(documentFieldValue(doc, ["본인부담금", "실결제금액", "actualPrice"])),
    startDate: documentDateToYymmdd(
      doc,
      ["서비스 시작일", "서비스시작일", "계약 시작일", "계약시작일", "startDate", "contractStartDate"],
      {
        year: ["계약 시작 년도", "계약시작년도", "계약 시작 연도", "계약시작연도", "시작 연도", "시작년도", "startYear"],
        month: ["계약 시작 월", "계약시작월", "시작 월", "시작월", "startMonth"],
        day: ["계약 시작 일", "계약시작일", "시작 일", "시작일", "startDay"],
      },
    ),
    endDate: documentDateToYymmdd(
      doc,
      ["서비스 종료일", "서비스종료일", "계약 종료일", "계약종료일", "endDate", "contractEndDate"],
      {
        year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "종료 연도", "종료년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "종료 월", "종료월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "종료 일", "종료일", "endDay"],
      },
    ),
    primaryEmployeeName,
    primaryEmployeePhone: firstValue(
      formatPhone(documentFieldValue(doc, [
        "제공인력 1 연락처",
        "제공인력1연락처",
        "제공인력 연락처",
        "제공인력 전화번호",
        "관리사 연락처",
        "산후관리사 연락처",
        "제공자 연락처",
        "caretaker1Contact",
        "caretakerContact",
        "employeePhone",
        "providerPhone",
      ])),
      recipientPhoneByName(doc, primaryEmployeeName),
    ),
    secondaryEmployeeName,
    secondaryEmployeePhone: firstValue(
      formatPhone(documentFieldValue(doc, [
        "제공인력 2 연락처",
        "제공인력2연락처",
        "보조 제공인력 연락처",
        "보조관리사 연락처",
        "caretaker2Contact",
        "secondaryEmployeePhone",
      ])),
      recipientPhoneByName(doc, secondaryEmployeeName),
    ),
  };

  for (const [key, value] of Object.entries(values) as Array<[keyof EformsignClientEditPrefill, string | number | undefined | null]>) {
    if (value !== null && value !== undefined && value !== "") {
      prefill[key] = value as never;
    }
  }

  return prefill;
}
