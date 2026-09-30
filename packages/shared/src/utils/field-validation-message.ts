import { isValidKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "./phone";

/**
 * Framework-free resolver that decides which validation message a form field
 * shows. It returns codes + params only; every surface (desktop, mobile,
 * service-record-ui) renders its own copy for a code.
 */

export type FieldKind = "text" | "phone" | "date";

export type FieldMessageCode =
    | "required"
    | "phone-format-hint"
    | "phone-format"
    | "date-format-hint"
    | "date-format"
    | "date-invalid"
    | "date-range";

export type FieldMessage = {
    tone: "hint" | "error";
    code: FieldMessageCode;
    params?: Record<string, string>;
};

export type FieldInputState = {
    value: string;
    /** The field has held a non-empty value since the form opened (or reset). */
    hadValue: boolean;
    /** The user left the field (blur) while it held a value. */
    touched: boolean;
    focused: boolean;
};

export type FieldMessageOptions = {
    required?: boolean;
    /** Form-level: the user already tried to submit. */
    submitted?: boolean;
    dateRange?: { notBefore?: string };
};

export function createFieldInputState(value = ""): FieldInputState {
    return { value, hadValue: value !== "", touched: false, focused: false };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_ISO_DATE_YEAR = 1900;

/** Real calendar date in YYYY-MM-DD form. Unlike birthdays, future dates are allowed. */
export function isRealIsoDate(value: string): boolean {
    if (!ISO_DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (year < MIN_ISO_DATE_YEAR) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
    );
}

function isCompletePhone(value: string): boolean {
    const digits = normalizeKoreanPhoneDigits(value);
    return (/^01\d{9}$/.test(digits)) || isValidKoreanPhoneNumber(value);
}

/** Hint while typing; error once the user left the field (or submitted). */
function incompleteMessage(
    state: FieldInputState,
    submitted: boolean,
    hintCode: FieldMessageCode,
    errorCode: FieldMessageCode,
): FieldMessage {
    if (state.focused) return { tone: "hint", code: hintCode };
    if (state.touched || submitted) return { tone: "error", code: errorCode };
    return { tone: "hint", code: hintCode };
}

export function resolveFieldMessage(
    kind: FieldKind,
    state: FieldInputState,
    opts: FieldMessageOptions = {},
): FieldMessage | null {
    const submitted = opts.submitted ?? false;

    if (state.value === "") {
        return opts.required && (state.hadValue || submitted)
            ? { tone: "error", code: "required" }
            : null;
    }

    if (kind === "phone") {
        return isCompletePhone(state.value)
            ? null
            : incompleteMessage(state, submitted, "phone-format-hint", "phone-format");
    }

    if (kind === "date") {
        if (!ISO_DATE_PATTERN.test(state.value)) {
            return incompleteMessage(state, submitted, "date-format-hint", "date-format");
        }
        if (!isRealIsoDate(state.value)) return { tone: "error", code: "date-invalid" };
        const notBefore = opts.dateRange?.notBefore;
        if (notBefore && isRealIsoDate(notBefore) && state.value < notBefore) {
            return { tone: "error", code: "date-range", params: { notBefore } };
        }
        return null;
    }

    return null;
}

const DIGITS_WITH_FINAL_CONSONANT = new Set(["0", "1", "3", "6", "7", "8"]);

function hasFinalConsonant(char: string): boolean {
    const code = char.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
    if (DIGITS_WITH_FINAL_CONSONANT.has(char)) return true;
    return false;
}

/** Appends the object particle 을/를 that matches the label's last character. */
export function withObjectParticle(label: string): string {
    const last = label.trimEnd().slice(-1);
    if (last === "") return label;
    return `${label}${hasFinalConsonant(last) ? "을" : "를"}`;
}
