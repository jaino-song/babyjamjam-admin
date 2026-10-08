import {
    resolveFieldMessage,
    type FieldInputState,
} from "../../../shared/src/utils/field-validation-message";
import {
    SERVICE_RECORD_HEADER_KEYS,
    getServiceRecordHeaderErrors,
    hasServiceRecordHeaderValues,
    type ServiceRecordHeaderErrors,
    type ServiceRecordHeaderValidationKey,
} from "../form-definition";
import { HEADER_REQUIRED_LABEL, fieldMessageToSlot, type SlotMessage } from "../field-messages";
import { errorMessage } from "./messages";

export const HEADER_DATE_KEYS: readonly ServiceRecordHeaderValidationKey[] = ["momBirth", "babyBirth"];

export interface HeaderErrorsOptions {
    adminMode: boolean;
    /** Administrator-only explicit error map; when present in admin mode it owns validation scope. */
    suppliedHeaderErrors: ServiceRecordHeaderErrors | undefined;
    now: Date;
}

export function resolveHeaderErrors(
    header: Record<string, unknown>,
    { adminMode, suppliedHeaderErrors, now }: HeaderErrorsOptions,
): { headerErrors: ServiceRecordHeaderErrors; usesScopedHeaderErrors: boolean; isHeaderComplete: boolean } {
    // Only an administrator editor with an explicit patch error map owns validation scope.
    // Employee forms and callers without that map still validate the complete header.
    const usesScopedHeaderErrors = adminMode && suppliedHeaderErrors !== undefined;
    const headerErrors: ServiceRecordHeaderErrors = usesScopedHeaderErrors ? (suppliedHeaderErrors ?? {}) : {
        ...suppliedHeaderErrors,
        ...getServiceRecordHeaderErrors(header, now, { required: !adminMode }),
    };
    // Presence plus the `now`-aware error map; never re-validate against the ambient clock.
    const isHeaderComplete = hasServiceRecordHeaderValues(header) && Object.keys(headerErrors).length === 0;
    return { headerErrors, usesScopedHeaderErrors, isHeaderComplete };
}

export interface HeaderFieldMessageContext {
    /** `header[key] ?? ""` */
    value: string;
    hadValue: boolean;
    touched: boolean;
    focused: boolean;
    submitted: boolean;
    adminMode: boolean;
    readOnly: boolean;
    suppliedHeaderErrors: ServiceRecordHeaderErrors | undefined;
    headerErrors: ServiceRecordHeaderErrors;
}

export function getHeaderFieldMessage(
    key: ServiceRecordHeaderValidationKey,
    {
        value,
        hadValue,
        touched,
        focused,
        submitted,
        adminMode,
        readOnly,
        suppliedHeaderErrors,
        headerErrors,
    }: HeaderFieldMessageContext,
): SlotMessage | null {
    if (readOnly) return null;
    const state: FieldInputState = { value, hadValue, touched, focused };
    const isDate = HEADER_DATE_KEYS.includes(key);
    const label = HEADER_REQUIRED_LABEL[key];
    const active = focused || touched || submitted;
    // Nothing shows for a value the user has not interacted with yet.
    const resolved = value === "" || active
        ? resolveFieldMessage(isDate ? "date" : "text", state, { required: !adminMode, submitted })
        : null;
    if (resolved && !(adminMode && resolved.tone === "error")) {
        return fieldMessageToSlot(resolved, { label, choice: key === "deliveryType" });
    }
    if (value === "") return null;
    const supplied = suppliedHeaderErrors?.[key];
    if (supplied) return errorMessage(supplied);
    const computed = (adminMode || active) ? headerErrors[key] : undefined;
    return computed ? errorMessage(computed) : null;
}

export function firstHeaderProblemKey(
    headerErrors: ServiceRecordHeaderErrors,
): ServiceRecordHeaderValidationKey | null {
    return SERVICE_RECORD_HEADER_KEYS.find((key) => headerErrors[key]) ?? null;
}
