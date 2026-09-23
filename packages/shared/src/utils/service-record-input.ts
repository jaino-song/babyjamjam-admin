import { isValidBirthdayIsoDate } from "./birthday";

/** Validation does not change values. Birthday input formatting belongs to the UI. */
export const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예: 이예지", inputMode: "text", helper: "성명은 ‘이예지’처럼 띄어쓰기 없이 붙여 써 주세요." },
    { k: "momBirth", label: "산모 생년월일 (YYYY-MM-DD)", ph: "1999-01-01", inputMode: "numeric", helper: "연도 4자리와 월·일을 숫자로 입력해 주세요(예: 19990101). 하이픈(-)은 자동으로 붙어요." },
    { k: "babyName", label: "신생아 성명", ph: "예: 이아기", inputMode: "text", helper: "신생아 성명은 ‘이아기’처럼 띄어쓰기 없이 붙여 써 주세요." },
    { k: "babyBirth", label: "신생아 출생일자 (YYYY-MM-DD)", ph: "1999-01-01", inputMode: "numeric", helper: "출생 연도 4자리와 월·일을 숫자로 입력해 주세요(예: 20260615). 하이픈(-)은 자동으로 붙어요." },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예: 3.2", inputMode: "decimal", helper: "kg는 쓰지 말고 숫자만 입력해 주세요(예: 3.2)." },
] as const;

export const SERVICE_RECORD_HEADER_KEYS = [
    "momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight",
] as const;
export type ServiceRecordHeaderValidationKey = typeof SERVICE_RECORD_HEADER_KEYS[number];
export type ServiceRecordHeaderErrors = Partial<Record<ServiceRecordHeaderValidationKey, string>>;
export interface ServiceRecordHeaderValidationOptions {
    /** Partial administrator drafts may omit values; completed employee forms may not. */
    required?: boolean;
}

const LABELS: Record<ServiceRecordHeaderValidationKey, string> = {
    momName: "산모 성명", momBirth: "산모 생년월일", babyName: "신생아 성명",
    babyBirth: "신생아 출생일자", deliveryType: "분만형태", babyWeight: "신생아 몸무게",
};
const NAME_SPACING = /[\s\u200B\u2060\uFEFF]/u;
const BIRTH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

export function getServiceRecordHeaderFieldError(
    key: ServiceRecordHeaderValidationKey,
    rawValue: unknown,
    now: Date = new Date(),
    { required = false }: ServiceRecordHeaderValidationOptions = {},
): string | null {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        const requiredMessage: Record<ServiceRecordHeaderValidationKey, string> = {
            momName: "산모 성명을 입력해 주세요.", momBirth: "산모 생년월일을 입력해 주세요.",
            babyName: "신생아 성명을 입력해 주세요.", babyBirth: "신생아 출생일자를 입력해 주세요.",
            deliveryType: "분만형태를 선택해 주세요.", babyWeight: "신생아 몸무게를 입력해 주세요.",
        };
        return required ? requiredMessage[key] : null;
    }
    if (typeof rawValue !== "string") return `${LABELS[key]} 입력 형식을 확인해 주세요.`;

    if (key === "momName" || key === "babyName") {
        // Do not add a Korean-only alphabet or an arbitrary name-length restriction.
        return NAME_SPACING.test(rawValue)
            ? `${LABELS[key]}에는 띄어쓰기를 사용할 수 없으니 ‘${key === "momName" ? "이예지" : "이아기"}’처럼 붙여 입력해 주세요.`
            : null;
    }
    if (key === "deliveryType") {
        return rawValue === "자연분만" || rawValue === "제왕절개"
            ? null : "분만형태는 자연분만 또는 제왕절개 중에서 선택해 주세요.";
    }
    if (key === "babyWeight") {
        return !/\s/u.test(rawValue) && WEIGHT_PATTERN.test(rawValue) && Number.isFinite(Number(rawValue)) && Number(rawValue) > 0
            ? null : "몸무게는 kg나 공백 없이 0보다 큰 숫자로 입력해 주세요(예: 3.2).";
    }
    if (rawValue.length !== 10 || !BIRTH_PATTERN.test(rawValue)) {
        return "연도 4자리와 월·일을 YYYY-MM-DD 형식으로 입력해 주세요(예: 1999-01-01).";
    }
    return isValidBirthdayIsoDate(rawValue, now)
        ? null : "달력에 있는 날짜 중 1900년 1월 1일부터 오늘까지의 날짜를 입력해 주세요.";
}

export function getServiceRecordHeaderErrors(
    header: Record<string, unknown>,
    now: Date = new Date(),
    options: ServiceRecordHeaderValidationOptions = {},
): ServiceRecordHeaderErrors {
    const errors: ServiceRecordHeaderErrors = {};
    for (const key of SERVICE_RECORD_HEADER_KEYS) {
        const error = getServiceRecordHeaderFieldError(key, header[key], now, options);
        if (error) errors[key] = error;
    }
    return errors;
}
