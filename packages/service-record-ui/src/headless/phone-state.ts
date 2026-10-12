import { resolveFieldMessage } from "../../../shared/src/utils/field-validation-message";
import { fieldMessageToSlot, type SlotMessage } from "../field-messages";
import { errorMessage } from "./messages";

const PHONE_DIGITS_REQUIRED = 10;
// The phone rule stays "at least 10 digits". The shared resolver only needs to know
// whether the value is complete, so it is probed with a fixed complete/incomplete value.
const PHONE_COMPLETE_PROBE = "01012345678";
const PHONE_INCOMPLETE_PROBE = "0";

export interface PhoneStateContext {
    hadValue: boolean;
    touched: boolean;
    focused: boolean;
    submitted: boolean;
    /** A failure that belongs to the phone field itself (e.g. no match). */
    phoneFieldError?: string | null;
}

export function getPhoneState(
    phone: string,
    { hadValue, touched, focused, submitted, phoneFieldError }: PhoneStateContext,
): { digits: string; complete: boolean; message: SlotMessage | null } {
    const digits = phone.replace(/\D/g, "");
    const complete = digits.length >= PHONE_DIGITS_REQUIRED;
    const formatMessage = fieldMessageToSlot(
        resolveFieldMessage("phone", {
            value: phone === "" ? "" : complete ? PHONE_COMPLETE_PROBE : PHONE_INCOMPLETE_PROBE,
            hadValue,
            touched,
            focused,
        }, { required: true, submitted }),
        { label: "휴대폰 번호" },
    );
    // One slot, one message: a format error beats the caller's field error, which beats a hint.
    const message: SlotMessage | null = formatMessage?.tone === "error"
        ? formatMessage
        : phoneFieldError ? errorMessage(phoneFieldError) : formatMessage;
    return { digits, complete, message };
}
