import { withObjectParticle, type FieldMessage } from "../../shared/src/utils/field-validation-message";

/**
 * Copy for the one-line message slot shown at the top-right of every field.
 * Every string must stay short (about 20 Korean characters) because the slot
 * is exactly one label line tall and cuts longer text with an ellipsis.
 */
export type SlotMessage = { tone: "hint" | "error"; text: string };

export const FIELD_COPY = {
    phoneHint: "010-1234-5678 형식",
    phoneError: "010-1234-5678 형식으로 입력해 주세요",
    dateHint: "YYYY-MM-DD 형식",
    dateError: "YYYY-MM-DD 형식으로 입력해 주세요",
    dateInvalid: "존재하지 않는 날짜예요",
    serviceDateBefore: "이전 날짜는 선택할 수 없어요",
    multiHint: "여러 개 선택 가능",
    stoolColor: "변 색깔·상태를 적어 주세요",
    paymentConfirm: "결제 확인을 눌러 주세요",
} as const;

/** Short noun used in "required" messages (the long item labels carry numbers and notes). */
export const HEADER_REQUIRED_LABEL = {
    momName: "산모 성명",
    momBirth: "산모 생년월일",
    babyName: "신생아 성명",
    babyBirth: "신생아 출생일자",
    deliveryType: "분만형태",
    babyWeight: "신생아 몸무게",
} as const;

export const requiredInputCopy = (label: string): string => `${withObjectParticle(label)} 입력해 주세요`;
export const requiredChoiceCopy = (label: string): string => `${withObjectParticle(label)} 선택해 주세요`;
export const textLimitCopy = (max: number): string => `${max}자 이내로 줄여 주세요`;
export const textCounterCopy = (length: number, max: number): string => `${length}/${max}자`;

/** "① 회음절개부위 (또는 수술부위)" -> "회음절개부위" */
export function shortItemLabel(label: string): string {
    return label.replace(/^[①-⑳]\s*/u, "").replace(/\s*\(.*\)\s*$/u, "").trim();
}

export function fieldMessageToSlot(
    message: FieldMessage | null,
    copy: { label: string; choice?: boolean; rangeText?: string },
): SlotMessage | null {
    if (!message) return null;
    const tone = message.tone === "hint" ? "hint" : "error";
    switch (message.code) {
        case "required":
            return { tone, text: copy.choice ? requiredChoiceCopy(copy.label) : requiredInputCopy(copy.label) };
        case "phone-format-hint":
            return { tone, text: FIELD_COPY.phoneHint };
        case "phone-format":
            return { tone, text: FIELD_COPY.phoneError };
        case "date-format-hint":
            return { tone, text: FIELD_COPY.dateHint };
        case "date-format":
            return { tone, text: FIELD_COPY.dateError };
        case "date-invalid":
            return { tone, text: FIELD_COPY.dateInvalid };
        case "date-range":
            return { tone, text: copy.rangeText ?? FIELD_COPY.serviceDateBefore };
    }
}
