"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_HEADER_KEYS = exports.HEADER_FIELDS = void 0;
exports.getServiceRecordHeaderFieldError = getServiceRecordHeaderFieldError;
exports.getServiceRecordHeaderErrors = getServiceRecordHeaderErrors;
const birthday_1 = require("./birthday");
const field_validation_message_1 = require("./field-validation-message");
/** Validation does not change values. Birthday input formatting belongs to the UI. */
exports.HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예: 이예지", inputMode: "text" },
    { k: "momBirth", label: "산모 생년월일", ph: "1994-03-15", inputMode: "numeric" },
    { k: "babyName", label: "신생아 성명", ph: "예: 이아기", inputMode: "text" },
    { k: "babyBirth", label: "신생아 출생일자", ph: "2026-09-20", inputMode: "numeric" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예: 3.2", inputMode: "decimal" },
];
exports.SERVICE_RECORD_HEADER_KEYS = [
    "momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight",
];
const LABELS = {
    momName: "산모 성명", momBirth: "산모 생년월일", babyName: "신생아 성명",
    babyBirth: "신생아 출생일자", deliveryType: "분만형태", babyWeight: "신생아 몸무게",
};
const NAME_SPACING = /[\s\u200B\u2060\uFEFF]/u;
const BIRTH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
function getServiceRecordHeaderFieldError(key, rawValue, now = new Date(), { required = false } = {}) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        const verb = key === "deliveryType" ? "선택" : "입력";
        return required ? `${(0, field_validation_message_1.withObjectParticle)(LABELS[key])} ${verb}해 주세요` : null;
    }
    if (typeof rawValue !== "string")
        return "입력 형식을 확인해 주세요";
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
        return "YYYY-MM-DD 형식으로 입력해 주세요";
    }
    if ((0, birthday_1.isValidBirthdayIsoDate)(rawValue, now))
        return null;
    // A real calendar date from 1900 that still fails is a date after today.
    return (0, field_validation_message_1.isRealIsoDate)(rawValue) ? "오늘 이후 날짜는 안 돼요" : "존재하지 않는 날짜예요";
}
function getServiceRecordHeaderErrors(header, now = new Date(), options = {}) {
    const errors = {};
    for (const key of exports.SERVICE_RECORD_HEADER_KEYS) {
        const error = getServiceRecordHeaderFieldError(key, header[key], now, options);
        if (error)
            errors[key] = error;
    }
    return errors;
}
