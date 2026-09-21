"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_HEADER_KEYS = exports.HEADER_FIELDS = void 0;
exports.getServiceRecordHeaderFieldError = getServiceRecordHeaderFieldError;
exports.getServiceRecordHeaderErrors = getServiceRecordHeaderErrors;
const birthday_1 = require("./birthday");
/** Input values are validated as entered, never trimmed, truncated or guessed. */
exports.HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예: 이예지", inputMode: "text", helper: "성명은 ‘이예지’처럼 띄어쓰기 없이 붙여 써 주세요." },
    { k: "momBirth", label: "산모 생년월일 (숫자 6자리)", ph: "예: 900101", inputMode: "numeric", helper: "1990년 1월 1일은 900101이에요. 연도 끝 2자리와 월·일을 붙여 써 주세요." },
    { k: "babyName", label: "신생아 성명", ph: "예: 이아기", inputMode: "text", helper: "신생아 성명은 ‘이아기’처럼 띄어쓰기 없이 붙여 써 주세요." },
    { k: "babyBirth", label: "신생아 출생일자 (숫자 6자리)", ph: "예: 260615", inputMode: "numeric", helper: "2026년 6월 15일은 260615예요. 공백이나 기호 없이 숫자 6자리로 써 주세요." },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예: 3.2", inputMode: "decimal", helper: "kg는 쓰지 말고 숫자만 입력해 주세요(예: 3.2)." },
];
exports.SERVICE_RECORD_HEADER_KEYS = [
    "momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight",
];
const LABELS = {
    momName: "산모 성명", momBirth: "산모 생년월일", babyName: "신생아 성명",
    babyBirth: "신생아 출생일자", deliveryType: "분만형태", babyWeight: "신생아 몸무게",
};
const NAME_SPACING = /[\s\u200B\u2060\uFEFF]/u;
const BIRTH_PATTERN = /^\d{6}$/;
const WEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
function getServiceRecordHeaderFieldError(key, rawValue, now = new Date(), { required = false } = {}) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        const requiredMessage = {
            momName: "산모 성명을 입력해 주세요.", momBirth: "산모 생년월일을 입력해 주세요.",
            babyName: "신생아 성명을 입력해 주세요.", babyBirth: "신생아 출생일자를 입력해 주세요.",
            deliveryType: "분만형태를 선택해 주세요.", babyWeight: "신생아 몸무게를 입력해 주세요.",
        };
        return required ? requiredMessage[key] : null;
    }
    if (typeof rawValue !== "string")
        return `${LABELS[key]} 입력 형식을 확인해 주세요.`;
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
    if (rawValue.length !== 6 || !BIRTH_PATTERN.test(rawValue)) {
        const example = key === "momBirth" ? "1990년 1월 1일 → 900101" : "2026년 6월 15일 → 260615";
        return `연도 끝 2자리와 월·일을 붙여 숫자 6자리로 입력해 주세요(예: ${example}).`;
    }
    return (0, birthday_1.normalizeContractBirthday)(rawValue, now) !== null
        ? null : "달력에 없거나 오늘보다 늦은 날짜이니 생년월일을 다시 확인해 주세요.";
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
