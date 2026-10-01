/**
 * Framework-free resolver that decides which validation message a form field
 * shows. It returns codes + params only; every surface (desktop, mobile,
 * service-record-ui) renders its own copy for a code.
 */
export type FieldKind = "text" | "phone" | "date";
export type FieldMessageCode = "required" | "phone-format-hint" | "phone-format" | "date-format-hint" | "date-format" | "date-invalid" | "date-range";
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
    dateRange?: {
        notBefore?: string;
    };
};
export declare function createFieldInputState(value?: string): FieldInputState;
/** Real calendar date in YYYY-MM-DD form. Unlike birthdays, future dates are allowed. */
export declare function isRealIsoDate(value: string): boolean;
export declare function resolveFieldMessage(kind: FieldKind, state: FieldInputState, opts?: FieldMessageOptions): FieldMessage | null;
/** Appends the object particle 을/를 that matches the label's last character. */
export declare function withObjectParticle(label: string): string;
