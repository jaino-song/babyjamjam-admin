// Mirror of new admin rules; pinned by backend parity specs and /tmp/legacy-contract-stage-parity.cjs.

type UnknownRecord = Record<string, unknown>;
interface EformsignApiDocumentResponse { fields?: unknown; detail_template_info?: unknown; }

const FIELD_VALUE_KEYS = [
    "value",
    "field_value",
    "fieldValue",
    "input_value",
    "inputValue",
    "data",
    "text",
] as const;

export function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

export function stringFromUnknown(value: unknown): string | null {
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
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectRecords(item, depth + 1));
    }
    if (!isRecord(value)) return [];
    return [
        value,
        ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
    ];
}

function normalizeFieldId(value: string): string {
    return value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
    for (const key of FIELD_VALUE_KEYS) {
        const value = stringFromUnknown(record[key]);
        if (value) return value;
    }
    return null;
}

const FIELD_ID_KEYS = [
    "id",
    "field_id",
    "fieldId",
    "name",
    "label",
    "field_name",
    "fieldName",
    "display_name",
    "displayName",
    "input_id",
    "inputId",
] as const;

function keyedFieldValue(
    source: unknown,
    aliases: readonly string[],
): string | null {
    for (const record of collectRecords(source)) {
        for (const [key, rawValue] of Object.entries(record)) {
            if (!keyedFieldIdMatches(key, aliases)) continue;

            const directValue = stringFromUnknown(rawValue);
            if (directValue) return directValue;

            if (isRecord(rawValue)) {
                const nestedValue = valueFromFieldRecord(rawValue);
                if (nestedValue) return nestedValue;
            }
        }
    }
    return null;
}

function fieldIdMatches(token: string, aliases: readonly string[]): boolean {
    const normalizedToken = normalizeFieldId(token);
    return aliases.some((alias) => {
        const normalizedAlias = normalizeFieldId(alias);
        if (normalizedToken === normalizedAlias) return true;
        // Short labels such as "주소" or "연락처" must not match provider fields.
        if (normalizedAlias.length < 5) return false;
        return normalizedToken.includes(normalizedAlias)
            || normalizedAlias.includes(normalizedToken);
    });
}

function keyedFieldIdMatches(key: string, aliases: readonly string[]): boolean {
    const normalizedKey = normalizeFieldId(key);
    return aliases.some((alias) => normalizedKey === normalizeFieldId(alias));
}

export function eformsignDocumentFieldValue(
    document: EformsignApiDocumentResponse,
    aliases: readonly string[],
): string | null {
    for (const source of [document.fields, document.detail_template_info]) {
        const keyedValue = keyedFieldValue(source, aliases);
        if (keyedValue) return keyedValue;

        for (const record of collectRecords(source)) {
            const tokens = FIELD_ID_KEYS
                .map((key) => stringFromUnknown(record[key]))
                .filter((value): value is string => Boolean(value));
            if (tokens.some((token) => fieldIdMatches(token, aliases))) {
                const value = valueFromFieldRecord(record);
                if (value) return value;
            }
        }
    }
    return null;
}

function digits(value: string | null): string | null {
    const normalized = value?.replace(/\D/g, "") ?? "";
    return normalized.length > 0 ? normalized : null;
}

function validUtcDate(year: number, month: number, day: number): Date | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

function dateValue(value: string | null): Date | null {
    const normalized = digits(value);
    if (!normalized) return null;
    const yyyymmdd = normalized.length === 6
        ? `20${normalized}`
        : normalized.slice(0, 8);
    if (yyyymmdd.length !== 8) return null;
    return validUtcDate(
        Number(yyyymmdd.slice(0, 4)),
        Number(yyyymmdd.slice(4, 6)),
        Number(yyyymmdd.slice(6, 8)),
    );
}

function dateFromParts(
    document: EformsignApiDocumentResponse,
    aliases: {
        year: readonly string[];
        month: readonly string[];
        day: readonly string[];
    },
): Date | null {
    const yearDigits = digits(eformsignDocumentFieldValue(document, aliases.year));
    const monthDigits = digits(eformsignDocumentFieldValue(document, aliases.month));
    const dayDigits = digits(eformsignDocumentFieldValue(document, aliases.day));
    if (!yearDigits || !monthDigits || !dayDigits) return null;
    const year = yearDigits.length === 2 ? Number(`20${yearDigits}`) : Number(yearDigits);
    return validUtcDate(year, Number(monthDigits), Number(dayDigits));
}

export function extractEformsignContractEndDate(
    document: EformsignApiDocumentResponse,
): Date | null {
    return dateValue(eformsignDocumentFieldValue(document, [
        "계약 종료일",
        "계약종료일",
        "서비스 종료일",
        "서비스종료일",
        "endDate",
        "contractEndDate",
    ])) ?? dateFromParts(document, {
        year: ["계약 종료 년도", "계약종료년도", "서비스 종료 년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "서비스 종료 월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "서비스 종료 일", "endDay"],
    }) ?? contractPeriodDates(document)[1];
}

function contractPeriodDates(
    document: EformsignApiDocumentResponse,
): [Date | null, Date | null] {
    const period = eformsignDocumentFieldValue(document, [
        "계약 기간",
        "계약기간",
        "서비스 기간",
        "서비스기간",
        "contractPeriod",
        "servicePeriod",
    ]);
    const matches = period?.match(/\d{2,4}\D*\d{1,2}\D*\d{1,2}/g) ?? [];
    return [dateValue(matches[0] ?? null), dateValue(matches[1] ?? null)];
}
