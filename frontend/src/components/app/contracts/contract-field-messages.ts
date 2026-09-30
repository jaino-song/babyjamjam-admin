import { isValidBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import {
    isRealIsoDate,
    resolveFieldMessage,
    type FieldInputState,
} from "@babyjamjam/shared/utils/field-validation-message";

import { toFieldMessageView, type FieldMessageView } from "@/lib/forms/field-message-text";
import { t, type Locale } from "@/lib/i18n/translations";

/**
 * Inline-validated inputs of the contract creation wizard. Each shows at most
 * one message in the top-right slot of its label row.
 */
export type ContractInputField =
    | "birthday"
    | "dueDate"
    | "birthDate"
    | "startDate"
    | "endDate"
    | "paymentDate";

/** The customer phone is validated inside `ContactInput`; submit only needs to find it. */
export type ContractFocusTarget = ContractInputField | "phone";

export const CONTRACT_CUSTOMER_INFO_STEP_INDEX = 0;
export const CONTRACT_DATES_STEP_INDEX = 3;

interface ContractInputFieldConfig {
    step: number;
    required: boolean;
    /** Locale key of the label; it names the field in the "required" message. */
    labelKey: string;
    /** `id` of the input, so submit can scroll to and focus the first problem. */
    inputId: string;
    /** Example date shown as the placeholder. */
    placeholder: string;
}

export const CONTRACT_INPUT_FIELD_CONFIG: Record<ContractInputField, ContractInputFieldConfig> = {
    birthday: {
        step: CONTRACT_CUSTOMER_INFO_STEP_INDEX,
        required: false,
        labelKey: "contract-msg.birthday-label",
        inputId: "contract-creation-birthday",
        placeholder: "1958-03-03",
    },
    dueDate: {
        step: CONTRACT_CUSTOMER_INFO_STEP_INDEX,
        required: false,
        labelKey: "clients.form.due-date",
        inputId: "contract-creation-due-date",
        placeholder: "2026-11-20",
    },
    birthDate: {
        step: CONTRACT_CUSTOMER_INFO_STEP_INDEX,
        required: false,
        labelKey: "clients.form.birth-date",
        inputId: "contract-creation-birth-date",
        placeholder: "2026-11-20",
    },
    startDate: {
        step: CONTRACT_DATES_STEP_INDEX,
        required: true,
        labelKey: "contract-msg.start-date-label",
        inputId: "contract-creation-start-date",
        placeholder: "2026-12-01",
    },
    endDate: {
        step: CONTRACT_DATES_STEP_INDEX,
        required: false,
        labelKey: "contract-msg.end-date-label",
        inputId: "contract-creation-end-date",
        placeholder: "2026-12-19",
    },
    paymentDate: {
        step: CONTRACT_DATES_STEP_INDEX,
        required: true,
        labelKey: "contract-msg.payment-date-label",
        inputId: "contract-creation-payment-date",
        placeholder: "2026-11-25",
    },
};

/** Fields in on-screen order, grouped by wizard step. */
export const CONTRACT_INPUT_FIELDS_BY_STEP: Readonly<Record<number, readonly ContractInputField[]>> = {
    [CONTRACT_CUSTOMER_INFO_STEP_INDEX]: ["birthday", "dueDate", "birthDate"],
    [CONTRACT_DATES_STEP_INDEX]: ["startDate", "endDate", "paymentDate"],
};

export const CONTRACT_INPUT_FIELDS = Object.keys(CONTRACT_INPUT_FIELD_CONFIG) as ContractInputField[];

/** The date in `value` when it is a real YYYY-MM-DD date, otherwise null. */
export function toRealIsoDate(value: string): string | null {
    return isRealIsoDate(value) ? value : null;
}

interface ResolveContractFieldMessageInput {
    locale: Locale;
    field: ContractInputField;
    state: FieldInputState;
    /** The user already tried to continue past the step this field is on. */
    submitted: boolean;
    /** Current contract start date, the lower bound of the end date. */
    startDate: string;
}

/**
 * The one message a contract date field shows in its label-row slot, or null.
 * Birthdays additionally reject dates that are real but in the future.
 */
export function resolveContractFieldMessage({
    locale,
    field,
    state,
    submitted,
    startDate,
}: ResolveContractFieldMessageInput): FieldMessageView | null {
    const config = CONTRACT_INPUT_FIELD_CONFIG[field];
    const message = toFieldMessageView(
        locale,
        resolveFieldMessage("date", state, {
            required: config.required,
            submitted,
            ...(field === "endDate" ? { dateRange: { notBefore: startDate } } : {}),
        }),
        t(locale, config.labelKey),
    );
    if (message) return message;

    if (field === "birthday" && state.value.length === 10 && !isValidBirthdayIsoDate(state.value)) {
        return { tone: "error", text: t(locale, "form.validation.birthday-future") };
    }
    return null;
}

/**
 * Whether the customer phone would show an error once the user left the field
 * and pressed continue: empty (it is required) or not a complete number.
 */
export function hasContractPhoneProblem(phone: string): boolean {
    return resolveFieldMessage(
        "phone",
        { value: phone, hadValue: true, touched: true, focused: false },
        { required: true, submitted: true },
    )?.tone === "error";
}
