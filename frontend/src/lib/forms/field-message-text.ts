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

/**
 * The one message a field shows in its label-row slot. Whatever the field's own
 * rules and status report (error, then in-progress hint, then status) wins;
 * static guidance is the lowest priority and returns as soon as nothing else
 * applies, so clearing an error brings the guidance back.
 */
export function withGuidance(
    message: FieldMessageView | null,
    guidance?: string | null,
): FieldMessageView | null {
    if (message) return message;
    return guidance ? { tone: "hint", text: guidance } : null;
}

/** Static guidance for a new-password field: what a valid password needs. */
export const PASSWORD_GUIDANCE = "소문자·숫자·특수문자 8자 이상";

const PASSWORD_REQUIREMENT_SHORT_LABELS: Record<string, string> = {
    "최소 8자 이상": "8자 이상",
    "소문자 포함": "소문자",
    "숫자 포함": "숫자",
    "특수문자 포함": "특수문자",
};

/**
 * Live progress for a password being typed, as one slot message: the
 * requirements still missing (hint) or a confirmation once all are met (ok).
 * Returns null for an empty password so the static guidance shows instead.
 */
export function getPasswordRequirementMessage(
    password: string,
    requirements: ReadonlyArray<{ label: string; met: boolean }>,
): FieldMessageView | null {
    if (!password) return null;
    const missing = requirements.filter((requirement) => !requirement.met);
    if (missing.length === 0) return { tone: "ok", text: "사용할 수 있는 비밀번호예요" };
    const names = missing.map((requirement) => PASSWORD_REQUIREMENT_SHORT_LABELS[requirement.label] ?? requirement.label);
    return { tone: "hint", text: `${names.join("·")} 필요` };
}
