import { SERVICE_RECORD_FORM_LAYOUT } from "../../shared/src/constants/service-record-form-layout";
import { normalizeContractBirthday } from "../../shared/src/utils/birthday";

export type ItemType = "multi" | "radio" | "counts" | "stool" | "textarea" | "confirm";

export interface DailyItemCount {
    k: string;
    label: string;
    unit: string;
    min?: number;
    step?: number;
}

export interface DailyItem {
    key: string;
    label: string;
    type: ItemType;
    opts?: string[];
    counts?: DailyItemCount[];
    maxLength?: number;
}

export const SERVICE_RECORD_TEXT_LIMITS = {
    etcService: 40,
    notes: 80,
} as const;

const SERVICE_RECORD_FIELDS_BY_KEY = new Map(
    SERVICE_RECORD_FORM_LAYOUT.flatMap((section) => section.fields).map((field) => [field.key, field]),
);

function getDailyItemCounts(key: string): DailyItemCount[] {
    const field = SERVICE_RECORD_FIELDS_BY_KEY.get(key);
    return (field?.subKeys ?? []).map((subKey) => ({
        k: subKey.key.startsWith(`${key}_`) ? subKey.key.slice(key.length + 1) : subKey.key,
        label: subKey.label,
        unit: subKey.unit,
        min: subKey.min,
        step: subKey.step,
    }));
}

export const DAILY_ITEMS: DailyItem[] = [
    { key: "perineum", label: "① 회음절개부위 (또는 수술부위)", type: "multi", opts: ["이상없음", "열상", "혈종", "불편감"] },
    { key: "breast", label: "② 유방상태", type: "multi", opts: ["이상없음", "울혈", "통증"] },
    { key: "excretion", label: "③ 배뇨/배변", type: "multi", opts: ["이상없음", "불편감"] },
    { key: "sitzBath", label: "④ 좌욕", type: "radio", opts: ["실시", "미실시"] },
    { key: "meals", label: "⑤ 식사/간식", type: "counts", counts: getDailyItemCounts("meals") },
    { key: "temperature", label: "⑥ 체온", type: "counts", counts: getDailyItemCounts("temperature") },
    { key: "sleep", label: "⑦ 수면 양상", type: "radio", opts: ["잘 잠", "잘 못 잠"] },
    { key: "breastFeeding", label: "⑧ 모유수유", type: "counts", counts: getDailyItemCounts("breastFeeding") },
    { key: "formulaFeeding", label: "⑨ 분유수유", type: "counts", counts: getDailyItemCounts("formulaFeeding") },
    { key: "stool", label: "⑩ 배변양상", type: "stool", opts: ["정상변", "이상변"] },
    { key: "bath", label: "⑪ 목욕·제대관리", type: "radio", opts: ["실시", "미실시"] },
    {
        key: "etcService",
        label: "기타 서비스 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.etcService,
    },
    {
        key: "notes",
        label: "특이사항 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.notes,
    },
    { key: "paymentConfirmed", label: "결제 확인", type: "confirm" },
];

export type ServiceRecordNumericErrors = Record<string, string>;

const SERVICE_RECORD_NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isStepAligned(value: number, step: number): boolean {
    if (Number.isInteger(value)) return true;
    const quotient = value / step;
    const nearest = Math.round(quotient);
    const tolerance = Number.EPSILON * Math.abs(quotient) * 10;
    return Math.abs(quotient - nearest) <= tolerance;
}

function formatNumericConstraint(value: number): string {
    return String(value);
}

function numericFieldErrorMessage(
    count: DailyItemCount,
    rawValue: unknown,
): string | null {
    if (rawValue === null || rawValue === undefined || rawValue === "") return null;

    const min = count.min ?? 0;
    const step = count.step ?? 1;
    if (typeof rawValue !== "string" && typeof rawValue !== "number") {
        return `${count.label}: 유효한 숫자를 입력해 주세요.`;
    }
    if (typeof rawValue === "string" && !SERVICE_RECORD_NUMERIC_PATTERN.test(rawValue)) {
        return `${count.label}: 유효한 숫자를 입력해 주세요.`;
    }

    const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return `${count.label}: 유효한 숫자를 입력해 주세요.`;
    }
    if (parsed < min) {
        return `${count.label}: ${formatNumericConstraint(min)} 이상으로 입력해 주세요.`;
    }
    if (!isStepAligned(parsed - min, step)) {
        return `${count.label}: ${formatNumericConstraint(step)} 단위로 입력해 주세요.`;
    }
    if (step === 1 && !Number.isSafeInteger(parsed)) {
        return `${count.label}: 안전한 정수로 입력해 주세요.`;
    }
    return null;
}

const SERVICE_RECORD_NUMERIC_COUNTS = new Map<string, DailyItemCount>(
    DAILY_ITEMS.flatMap((item) => item.type === "counts"
        ? (item.counts ?? []).map((count) => [`${item.key}_${count.k}`, count] as const)
        : []),
);

export function getServiceRecordNumericFieldError(
    key: string,
    rawValue: unknown,
): string | null {
    const count = SERVICE_RECORD_NUMERIC_COUNTS.get(key);
    return count ? numericFieldErrorMessage(count, rawValue) : null;
}

export function getServiceRecordNumericErrors(
    draft: Record<string, unknown>,
): ServiceRecordNumericErrors {
    const errors: ServiceRecordNumericErrors = {};
    for (const [key, count] of SERVICE_RECORD_NUMERIC_COUNTS) {
        const error = numericFieldErrorMessage(count, draft[key]);
        if (error) errors[key] = error;
    }
    return errors;
}

export function hasInvalidServiceRecordNumericAnswers(
    draft: Record<string, unknown>,
): boolean {
    return Object.keys(getServiceRecordNumericErrors(draft)).length > 0;
}

export interface DayPage {
    title: string;
    items: number[];
    confirmation?: boolean;
}

export const DAY_PAGES: DayPage[] = [
    { title: "산모 기록", items: [0, 1, 2, 3, 4] },
    { title: "신생아 기록", items: [5, 6, 7, 8, 9, 10] },
    { title: "서비스 기록", items: [11, 12, 13] },
    {
        title: "기록 내용 확인",
        items: [],
        confirmation: true,
    },
];

export const DEFAULT_DAILY_ANSWERS: Record<string, unknown> = {
    perineum: ["이상없음"],
    breast: ["이상없음"],
    excretion: ["이상없음"],
    sitzBath: "실시",
    sleep: "잘 잠",
    stool: "정상변",
    bath: "실시",
};

export const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예) 홍길동" },
    { k: "momBirth", label: "산모 생년월일 (YYMMDD)", ph: "예) 900101" },
    { k: "babyName", label: "신생아 성명", ph: "예) 홍아기" },
    { k: "babyBirth", label: "신생아 출생일자 (YYMMDD)", ph: "예) 260615" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예) 3.2" },
] as const;

export type ServiceRecordHeaderValidationKey = "momBirth" | "babyBirth" | "babyWeight";
export type ServiceRecordHeaderErrors = Partial<Record<ServiceRecordHeaderValidationKey, string>>;

const SERVICE_RECORD_HEADER_DATE_PATTERN = /^\d{6}$/;
const SERVICE_RECORD_HEADER_WEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

const SERVICE_RECORD_HEADER_ERROR_MESSAGES: Record<ServiceRecordHeaderValidationKey, string> = {
    momBirth: "산모 생년월일은 YYMMDD 6자리의 유효한 날짜로 입력해 주세요.",
    babyBirth: "신생아 출생일자는 YYMMDD 6자리의 유효한 날짜로 입력해 주세요.",
    babyWeight: "신생아 몸무게는 0보다 큰 숫자로 입력해 주세요.",
};

function isPositiveDecimal(value: string): boolean {
    if (!SERVICE_RECORD_HEADER_WEIGHT_PATTERN.test(value)) return false;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0;
}

export function getServiceRecordHeaderFieldError(
    key: ServiceRecordHeaderValidationKey,
    rawValue: unknown,
    now: Date = new Date(),
): string | null {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) return null;

    if (key === "babyWeight") {
        return isPositiveDecimal(value) ? null : SERVICE_RECORD_HEADER_ERROR_MESSAGES[key];
    }

    return SERVICE_RECORD_HEADER_DATE_PATTERN.test(value)
        && normalizeContractBirthday(value, now) !== null
        ? null
        : SERVICE_RECORD_HEADER_ERROR_MESSAGES[key];
}

export function getServiceRecordHeaderErrors(
    header: Record<string, unknown>,
    now: Date = new Date(),
): ServiceRecordHeaderErrors {
    const errors: ServiceRecordHeaderErrors = {};
    for (const key of ["momBirth", "babyBirth", "babyWeight"] as const) {
        const error = getServiceRecordHeaderFieldError(key, header[key], now);
        if (error) errors[key] = error;
    }
    return errors;
}

export const REVIEW_EMPTY_LABEL = "입력 없음";

export const REVIEW_SECTIONS = [
    { id: "mom", title: "산모", tone: "mom", fields: DAILY_ITEMS.slice(0, 5) },
    { id: "baby", title: "신생아", tone: "baby", fields: DAILY_ITEMS.slice(5, 11) },
    { id: "finish", title: "서비스 기록", tone: "finish", fields: DAILY_ITEMS.slice(11, 14) },
] as const;

export const hasDisplayValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasDisplayValue);
    if (typeof value === "string") return value.trim().length > 0;
    return true;
};

export const isServiceRecordHeaderComplete = (header: Record<string, unknown>): boolean => (
    HEADER_FIELDS.every((field) => hasDisplayValue(header[field.k])) && hasDisplayValue(header.deliveryType)
);

export function formatReviewFieldValue(
    field: DailyItem,
    draft: Record<string, unknown>,
): { value: string; ok?: boolean } {
    if (field.type === "confirm") {
        return Boolean(draft[field.key]) ? { value: "✓ 확인 완료", ok: true } : { value: "" };
    }

    if (field.type === "multi") {
        const value = draft[field.key];
        const values = Array.isArray(value) ? value.filter(hasDisplayValue).map((item) => String(item).trim()) : [];
        return { value: values.join(", ") };
    }

    if (field.type === "radio" || field.type === "stool") {
        const value = hasDisplayValue(draft[field.key]) ? String(draft[field.key]).trim() : "";
        const colorValue = field.key === "stool" && hasDisplayValue(draft.stool_color)
            ? String(draft.stool_color).trim()
            : "";
        if (value && colorValue) return { value: `${value} (${colorValue})` };
        return { value };
    }

    if (field.type === "counts") {
        const parts = (field.counts ?? [])
            .map((count) => {
                const value = draft[`${field.key}_${count.k}`];
                if (!hasDisplayValue(value)) return null;
                const prefix = count.label === "횟수" || count.label === "체온" ? "" : `${count.label} `;
                return `${prefix}${String(value).trim()}${count.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    const value = draft[field.key];
    return { value: hasDisplayValue(value) ? String(value).trim() : "" };
}

export function isDailyItemComplete(item: DailyItem, draft: Record<string, unknown>): boolean {
    const value = draft[item.key];
    if (item.type === "textarea") return true;
    if (item.type === "multi") return Array.isArray(value) && value.length > 0;
    if (item.type === "radio") return hasDisplayValue(value);
    if (item.type === "counts") {
        return item.counts?.every((count) => hasDisplayValue(draft[`${item.key}_${count.k}`])) ?? false;
    }
    if (item.type === "stool") {
        return hasDisplayValue(value) && (value !== "이상변" || hasDisplayValue(draft[`${item.key}_color`]));
    }
    if (item.type === "confirm") return value === true;
    return false;
}

export function formatMonthDayKo(iso: string): string {
    const [, month = "", day = ""] = iso.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
    return iso ? `${iso.slice(0, 4)}.${month}.${day}` : "";
}

export function formatShortDate(iso: string): string {
    return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}
