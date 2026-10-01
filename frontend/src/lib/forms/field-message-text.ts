import {
    resolveFieldMessage,
    withObjectParticle,
    type FieldInputState,
    type FieldMessage,
    type FieldMessageOptions,
} from "@babyjamjam/shared/utils/field-validation-message";

import { t, type Locale } from "@/lib/i18n/translations";

/** A message ready to render in a field's label-row slot. */
export interface FieldMessageView {
    /** "ok" is a positive status, e.g. an available phone number. */
    tone: "hint" | "error" | "ok";
    text: string;
}

/** Copy for a resolver code. Korean attaches the object particle to the label. */
export function getFieldMessageText(locale: Locale, message: FieldMessage, label: string): string {
    const template = t(locale, `form.validation.${message.code}`);
    if (message.code !== "required") return template;
    return template.replace("{label}", locale === "ko" ? withObjectParticle(label) : label);
}

export function toFieldMessageView(
    locale: Locale,
    message: FieldMessage | null,
    label: string,
): FieldMessageView | null {
    return message
        ? { tone: message.tone, text: getFieldMessageText(locale, message, label) }
        : null;
}

/**
 * Phone resolver for forms whose backend accepts only 11-digit numbers. The
 * shared resolver also accepts 10-digit landlines; here those still count as
 * an incomplete number so the slot explains why the form will not submit.
 */
export function resolveElevenDigitPhoneMessage(
    state: FieldInputState,
    opts: FieldMessageOptions,
): FieldMessage | null {
    const message = resolveFieldMessage("phone", state, opts);
    if (message || state.value === "") return message;
    const digits = state.value.replace(/\D/g, "");
    return digits.length === 11 ? null : resolveFieldMessage("phone", { ...state, value: "0" }, opts);
}
