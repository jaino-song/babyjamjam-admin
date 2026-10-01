/** Validation does not change values. Birthday input formatting belongs to the UI. */
export declare const HEADER_FIELDS: readonly [{
    readonly k: "momName";
    readonly label: "산모 성명";
    readonly ph: "예: 이예지";
    readonly inputMode: "text";
}, {
    readonly k: "momBirth";
    readonly label: "산모 생년월일";
    readonly ph: "1994-03-15";
    readonly inputMode: "numeric";
}, {
    readonly k: "babyName";
    readonly label: "신생아 성명";
    readonly ph: "예: 이아기";
    readonly inputMode: "text";
}, {
    readonly k: "babyBirth";
    readonly label: "신생아 출생일자";
    readonly ph: "2026-09-20";
    readonly inputMode: "numeric";
}, {
    readonly k: "babyWeight";
    readonly label: "신생아 몸무게 (kg)";
    readonly ph: "예: 3.2";
    readonly inputMode: "decimal";
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
