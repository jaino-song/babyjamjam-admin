/** Validation does not change values. Birthday input formatting belongs to the UI. */
export declare const HEADER_FIELDS: readonly [{
    readonly k: "momName";
    readonly label: "산모 성명";
    readonly ph: "예: 이예지";
    readonly inputMode: "text";
    readonly helper: "성명은 ‘이예지’처럼 띄어쓰기 없이 붙여 써 주세요.";
}, {
    readonly k: "momBirth";
    readonly label: "산모 생년월일 (YYYY-MM-DD)";
    readonly ph: "1999-01-01";
    readonly inputMode: "numeric";
    readonly helper: "연도 4자리와 월·일을 숫자로 입력해 주세요(예: 19990101). 하이픈(-)은 자동으로 붙어요.";
}, {
    readonly k: "babyName";
    readonly label: "신생아 성명";
    readonly ph: "예: 이아기";
    readonly inputMode: "text";
    readonly helper: "신생아 성명은 ‘이아기’처럼 띄어쓰기 없이 붙여 써 주세요.";
}, {
    readonly k: "babyBirth";
    readonly label: "신생아 출생일자 (YYYY-MM-DD)";
    readonly ph: "1999-01-01";
    readonly inputMode: "numeric";
    readonly helper: "출생 연도 4자리와 월·일을 숫자로 입력해 주세요(예: 20260615). 하이픈(-)은 자동으로 붙어요.";
}, {
    readonly k: "babyWeight";
    readonly label: "신생아 몸무게 (kg)";
    readonly ph: "예: 3.2";
    readonly inputMode: "decimal";
    readonly helper: "kg는 쓰지 말고 숫자만 입력해 주세요(예: 3.2).";
}];
export declare const SERVICE_RECORD_HEADER_KEYS: readonly ["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"];
export type ServiceRecordHeaderValidationKey = typeof SERVICE_RECORD_HEADER_KEYS[number];
export type ServiceRecordHeaderErrors = Partial<Record<ServiceRecordHeaderValidationKey, string>>;
export interface ServiceRecordHeaderValidationOptions {
    /** Partial administrator drafts may omit values; completed employee forms may not. */
    required?: boolean;
}
export declare function getServiceRecordHeaderFieldError(key: ServiceRecordHeaderValidationKey, rawValue: unknown, now?: Date, { required }?: ServiceRecordHeaderValidationOptions): string | null;
export declare function getServiceRecordHeaderErrors(header: Record<string, unknown>, now?: Date, options?: ServiceRecordHeaderValidationOptions): ServiceRecordHeaderErrors;
