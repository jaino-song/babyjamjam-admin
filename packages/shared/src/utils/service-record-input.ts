import { isValidBirthdayIsoDate } from "./birthday";
import { isRealIsoDate, withObjectParticle } from "./field-validation-message";

/** Validation does not change values. Birthday input formatting belongs to the UI. */
export const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예: 이예지", inputMode: "text" },
    { k: "momBirth", label: "산모 생년월일", ph: "1994-03-15", inputMode: "numeric" },
    { k: "babyName", label: "신생아 성명", ph: "예: 이아기", inputMode: "text" },
    { k: "babyBirth", label: "신생아 출생일자", ph: "2026-09-20", inputMode: "numeric" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예: 3.2", inputMode: "decimal" },
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
        const verb = key === "deliveryType" ? "선택" : "입력";
        return required ? `${withObjectParticle(LABELS[key])} ${verb}해 주세요` : null;
    }
    if (typeof rawValue !== "string") return "입력 형식을 확인해 주세요";

    if (key === "momName" || key === "babyName") {
        // Do not add a Korean-only alphabet or an arbitrary name-length restriction.
        return NAME_SPACING.test(rawValue) ? "띄어쓰기 없이 입력해 주세요" : null;
    }
    if (key === "deliveryType") {
        return rawValue === "자연분만" || rawValue === "제왕절개"
            ? null : "분만형태를 선택해 주세요";
    }
    if (key === "babyWeight") {
        return !/\s/u.test(rawValue) && WEIGHT_PATTERN.test(rawValue) && Number.isFinite(Number(rawValue)) && Number(rawValue) > 0
            ? null : "0보다 큰 숫자로 (예: 3.2)";
    }
    if (rawValue.length !== 10 || !BIRTH_PATTERN.test(rawValue)) {
        return "YYYY-MM-DD로 입력해 주세요";
    }
    if (isValidBirthdayIsoDate(rawValue, now)) return null;
    // isRealIsoDate already rejects years before the 1900 floor (-> "not a real date"),
    // so a real date that still fails the birthday check can only lie in the future.
    return isRealIsoDate(rawValue) ? "미래 날짜는 입력할 수 없어요" : "존재하지 않는 날짜예요";
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
