"use client";

import { useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { formatIsoDateInput } from "../../shared/src/utils/date-input";
import {
    isRealIsoDate,
    resolveFieldMessage,
    type FieldInputState,
} from "../../shared/src/utils/field-validation-message";
import "./field-help.css";

import {
    DAILY_ITEMS,
    DAY_PAGES,
    HEADER_FIELDS,
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
    SERVICE_RECORD_HEADER_KEYS,
    formatMonthDayKo,
    formatReviewFieldValue,
    formatShortDate,
    getServiceRecordNumericErrors,
    getServiceRecordHeaderErrors,
    type ServiceRecordHeaderValidationKey,
    hasDisplayValue,
    hasServiceRecordHeaderValues,
    isDailyItemComplete,
    isServiceRecordHeaderComplete,
    type ServiceRecordNumericErrors,
} from "./form-definition";
import {
    FIELD_COPY,
    HEADER_REQUIRED_LABEL,
    fieldMessageToSlot,
    requiredChoiceCopy,
    requiredInputCopy,
    shortItemLabel,
    textCounterCopy,
    textLimitCopy,
    type SlotMessage,
} from "./field-messages";
import type {
    ServiceRecordWizardSlots,
    ServiceRecordWizardProps,
    SignatureSlotProps,
} from "./types";

const COMPONENT_SUFFIX = {
    topBar: "top-bar",
    body: "body",
} as const;

const HEADER_FIELD_COMPONENT_SUFFIX = {
    momName: "mom-name", momBirth: "mom-birth", babyName: "baby-name",
    babyBirth: "baby-birth", deliveryType: "delivery-type",
} as const;

const PHONE_INPUT_ID = "service-record-phone";
const SERVICE_DATE_INPUT_ID = "service-record-date";
const SERVICE_DATE_PLACEHOLDER = "2026-12-01";
const PHONE_DIGITS_REQUIRED = 10;
// The phone rule stays "at least 10 digits". The shared resolver only needs to know
// whether the value is complete, so it is probed with a fixed complete/incomplete value.
const PHONE_COMPLETE_PROBE = "01012345678";
const PHONE_INCOMPLETE_PROBE = "0";
const HEADER_DATE_KEYS: readonly ServiceRecordHeaderValidationKey[] = ["momBirth", "babyBirth"];
const COUNT_DISPLAY_LABEL: Record<string, string> = { "회당": "회당 용량" };

const errorMessage = (text: string): SlotMessage => ({ tone: "error", text });
const hintMessage = (text: string): SlotMessage => ({ tone: "hint", text });

/** `false` is an answer to the payment confirmation, but it is not a filled value. */
const isFilled = (value: unknown): boolean => value !== false && hasDisplayValue(value);

function focusFirstProblem(id: string | null | undefined) {
    if (!id || typeof document === "undefined") return;
    const element = document.getElementById(id);
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

function TextInput({
    value,
    onChange,
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            data-slot="in"
            className={`in ${props.className ?? ""}`.trim()}
            value={value}
            onChange={onChange}
        />
    );
}

/** One label line whose right side is the field's single, fixed-height message slot. */
function FieldLabelRow({
    dataComponent,
    label,
    htmlFor,
    slotId,
    message,
}: {
    dataComponent: string;
    label: string;
    htmlFor?: string;
    slotId: string;
    message: SlotMessage | null;
}) {
    return (
        <div data-component={`${dataComponent}_label-row`} data-slot="lab-row" className="lab-row">
            <label data-slot="lab" className="lab" htmlFor={htmlFor}>{label}</label>
            <span
                id={slotId}
                data-component={`${dataComponent}_helper`}
                data-slot="lab-msg"
                className={`lab-msg${message ? ` ${message.tone}` : ""}`}
                aria-live="polite"
                title={message?.text}
            >
                {message?.text}
            </span>
        </div>
    );
}

function FieldOptions({
    dataComponent,
    options,
    selected,
    onSelect,
    radio = false,
    disabled = false,
    firstOptionId,
    describedBy,
}: {
    dataComponent: string;
    options: string[];
    selected: (option: string) => boolean;
    onSelect: (option: string) => void;
    radio?: boolean;
    disabled?: boolean;
    firstOptionId?: string;
    describedBy?: string;
}) {
    return (
        <div data-component={dataComponent} data-slot="opts" className="opts">
            {options.map((option, optionIndex) => (
                <button
                    type="button"
                    key={option}
                    id={optionIndex === 0 ? firstOptionId : undefined}
                    aria-pressed={selected(option)}
                    aria-describedby={describedBy}
                    data-slot="opt"
                    className={`opt ${radio ? "radio " : ""}${selected(option) ? "sel" : ""}`}
                    disabled={disabled}
                    onClick={() => onSelect(option)}
                >
                    <span data-slot="box" className="box">{radio ? "●" : "✓"}</span>{option}
                </button>
            ))}
        </div>
    );
}

const dailyFieldSuffix = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const countInputId = (dataComponent: string, countKey: string): string => `${dataComponent}_count-options_${countKey}-input-control`;
const firstOptionIdOf = (dataComponent: string): string => `${dataComponent}-first-option`;
const stoolColorInputId = (dataComponent: string): string => `${dataComponent}-stool-color`;
const textareaInputId = (dataComponent: string, itemKey: string): string => `${dataComponent}-${itemKey === "etcService" ? "etc-service" : "notes"}`;

/** DOM id of the first control that keeps this item from being complete, or null when it is fine. */
function getDailyItemProblemId(
    item: (typeof DAILY_ITEMS)[number],
    dataComponent: string,
    draft: Record<string, unknown>,
    numericErrors: ServiceRecordNumericErrors,
): string | null {
    if (item.type === "textarea") {
        const text = draft[item.key];
        return item.maxLength !== undefined && typeof text === "string" && text.length > item.maxLength
            ? textareaInputId(dataComponent, item.key) : null;
    }
    if (item.type === "counts") {
        const count = (item.counts ?? []).find((candidate) => (
            !hasDisplayValue(draft[`${item.key}_${candidate.k}`]) || numericErrors[`${item.key}_${candidate.k}`]
        ));
        return count ? countInputId(dataComponent, count.k) : null;
    }
    if (isDailyItemComplete(item, draft)) return null;
    if (item.type === "stool" && hasDisplayValue(draft[item.key])) return stoolColorInputId(dataComponent);
    return firstOptionIdOf(dataComponent);
}

function DailyField({
    dataComponent,
    item,
    draft,
    onFieldChange,
    onToggleMulti,
    readOnly = false,
    numericErrors = {},
    submitted = false,
    requireAnswers = true,
}: {
    dataComponent: string;
    item: (typeof DAILY_ITEMS)[number];
    draft: Record<string, unknown>;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    readOnly?: boolean;
    numericErrors?: ServiceRecordNumericErrors;
    /** The user already pressed the page's next button with this page incomplete. */
    submitted?: boolean;
    /** Public employee forms require every answer; administrator drafts may leave answers blank. */
    requireAnswers?: boolean;
}) {
    const value = draft[item.key];
    const slotId = `${dataComponent}-helper`;
    const label = shortItemLabel(item.label);
    const [textFocused, setTextFocused] = useState(false);
    // A "required" message only appears once the field held a value and was cleared (or after submit).
    const hadValue = useRef<Record<string, boolean>>({});
    const trackHad = (key: string, candidate: unknown): boolean => {
        if (isFilled(candidate)) hadValue.current[key] = true;
        return Boolean(hadValue.current[key]);
    };
    const hadMain = trackHad(item.key, value);
    const hadColor = trackHad(`${item.key}_color`, draft[`${item.key}_color`]);
    const countHad = (item.counts ?? []).map((count) => trackHad(`${item.key}_${count.k}`, draft[`${item.key}_${count.k}`]));

    let message: SlotMessage | null = null;
    const invalidCountKeys = new Set<string>();
    if (item.type === "multi") {
        const empty = !Array.isArray(value) || value.filter(hasDisplayValue).length === 0;
        if (requireAnswers && empty) {
            message = hadMain || submitted ? errorMessage(requiredChoiceCopy(label)) : hintMessage(FIELD_COPY.multiHint);
        }
    } else if (item.type === "radio" || item.type === "stool") {
        if (requireAnswers && !hasDisplayValue(value) && (hadMain || submitted)) message = errorMessage(requiredChoiceCopy(label));
    } else if (item.type === "counts") {
        const counts = item.counts ?? [];
        for (const [countIndex, count] of counts.entries()) {
            const fieldKey = `${item.key}_${count.k}`;
            const numericError = numericErrors[fieldKey];
            let countMessage: SlotMessage | null = null;
            if (numericError) {
                countMessage = errorMessage(counts.length > 1 ? `${count.label}: ${numericError}` : numericError);
            } else if (requireAnswers && !hasDisplayValue(draft[fieldKey]) && (countHad[countIndex] || submitted)) {
                countMessage = errorMessage(requiredInputCopy(COUNT_DISPLAY_LABEL[count.label] ?? count.label));
            }
            if (!countMessage) continue;
            invalidCountKeys.add(fieldKey);
            message ??= countMessage;
        }
    } else if (item.type === "textarea") {
        const length = typeof value === "string" ? value.length : 0;
        if (!readOnly && item.maxLength !== undefined) {
            if (length > item.maxLength) message = errorMessage(textLimitCopy(item.maxLength));
            else if (length > 0 || textFocused) message = hintMessage(textCounterCopy(length, item.maxLength));
        }
    } else if (item.type === "confirm") {
        if (requireAnswers && !value && (hadMain || submitted)) message = errorMessage(FIELD_COPY.paymentConfirm);
    }
    const hasError = message?.tone === "error";
    const labelRow = (
        <FieldLabelRow
            dataComponent={dataComponent}
            label={item.label}
            htmlFor={item.type === "textarea" ? textareaInputId(dataComponent, item.key) : undefined}
            slotId={slotId}
            message={message}
        />
    );

    if (item.type === "multi") {
        return (
            <>
                {labelRow}
                <FieldOptions
                    dataComponent={`${dataComponent}_options`}
                    options={item.opts ?? []}
                    selected={(option) => Array.isArray(value) && (value as string[]).includes(option)}
                    onSelect={(option) => onToggleMulti(item.key, option)}
                    disabled={readOnly}
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                />
            </>
        );
    }

    if (item.type === "radio" || item.type === "stool") {
        const colorEmpty = !hasDisplayValue(draft[`${item.key}_color`]);
        const colorMessage = requireAnswers && colorEmpty && (hadColor || submitted) ? errorMessage(FIELD_COPY.stoolColor) : null;
        const colorSlotId = `${dataComponent}-stool-color-helper`;
        return (
            <>
                {labelRow}
                <FieldOptions
                    dataComponent={`${dataComponent}_radio-options`}
                    options={item.opts ?? []}
                    selected={(option) => value === option}
                    onSelect={(option) => onFieldChange(item.key, option)}
                    radio
                    disabled={readOnly}
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                />
                {item.type === "stool" && value === "이상변" && (
                    <div data-component={`${dataComponent}_stool-color`} data-slot="sub-fld" className="sub-fld">
                        <div data-component={`${dataComponent}_stool-color-input_label-row`} data-slot="lab-row" className="lab-row">
                            <label htmlFor={stoolColorInputId(dataComponent)} data-slot="lab" className="lab">이상변의 색깔과 상태</label>
                            <span
                                id={colorSlotId}
                                data-component={`${dataComponent}_stool-color-input_helper`}
                                data-slot="lab-msg"
                                className={`lab-msg${colorMessage ? ` ${colorMessage.tone}` : ""}`}
                                aria-live="polite"
                                title={colorMessage?.text}
                            >
                                {colorMessage?.text}
                            </span>
                        </div>
                        <TextInput
                            id={stoolColorInputId(dataComponent)}
                            data-component={`${dataComponent}_stool-color-input`}
                            placeholder="예: 초록색, 묽은 변"
                            value={(draft[`${item.key}_color`] as string) ?? ""}
                            disabled={readOnly}
                            aria-required={requireAnswers}
                            aria-invalid={colorMessage ? "true" : undefined}
                            aria-describedby={colorSlotId}
                            onChange={(event) => onFieldChange(`${item.key}_color`, event.target.value)}
                        />
                    </div>
                )}
            </>
        );
    }

    if (item.type === "counts") {
        return (
            <>
                {labelRow}
                <div data-component={`${dataComponent}_count-options`} data-slot="segrow" className="segrow">
                    {item.counts?.map((count) => {
                        const fieldKey = `${item.key}_${count.k}`;
                        const invalid = invalidCountKeys.has(fieldKey);
                        const countComponent = `${dataComponent}_count-options_${count.k}-input`;
                        return (
                            <div data-component={countComponent} data-slot="segnum-field" className="segnum-field" key={count.k}>
                                <div data-component={`${countComponent}_control-row`} data-slot="segnum" className="segnum">
                                    <span>{count.label}</span>
                                    <input
                                        data-slot="segnum-input"
                                        type="number"
                                        aria-label={count.label}
                                        aria-invalid={invalid ? "true" : undefined}
                                        id={countInputId(dataComponent, count.k)}
                                        data-component={`${countComponent}_control-row_control`}
                                        aria-describedby={slotId}
                                        placeholder={count.k === "temp" ? "36.5" : count.unit === "ml" ? "60" : "0"}
                                        inputMode={count.k === "temp" ? "decimal" : "numeric"}
                                        min={count.min ?? 0}
                                        step={count.step ?? 1}
                                        value={(draft[fieldKey] as string) ?? ""}
                                        disabled={readOnly}
                                        onChange={(event) => onFieldChange(fieldKey, event.target.value)}
                                    />
                                    <span>{count.unit}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    }

    if (item.type === "textarea") {
        const placeholder = item.key === "etcService" ? "예: 신생아 옷 정리" : "예: 산모 요청으로 간식 시간을 변경함";
        const fieldDataComponent = item.key === "etcService" ? "etc-service" : "notes";
        const textValue = (value as string) ?? "";
        return (
            <>
                {labelRow}
                <textarea
                    id={textareaInputId(dataComponent, item.key)}
                    aria-label={item.label}
                    aria-describedby={slotId}
                    aria-invalid={hasError ? "true" : undefined}
                    data-component={`${dataComponent}_${fieldDataComponent}`}
                    data-slot="ta"
                    className="ta"
                    value={textValue}
                    onChange={(event) => onFieldChange(item.key, event.target.value)}
                    onFocus={() => setTextFocused(true)}
                    onBlur={() => setTextFocused(false)}
                    placeholder={placeholder}
                    maxLength={item.maxLength}
                    disabled={readOnly}
                />
            </>
        );
    }

    if (item.type === "confirm") {
        return (
            <>
                {labelRow}
                <FieldOptions
                    dataComponent={`${dataComponent}_confirm-options`}
                    options={["결제 확인 완료"]}
                    selected={() => Boolean(value)}
                    onSelect={() => onFieldChange(item.key, !value)}
                    disabled={readOnly}
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                />
            </>
        );
    }

    return null;
}

function MomConfirmationReview({
    dataComponent,
    draft,
    editing,
    onEdit,
    readOnly = false,
}: {
    dataComponent: string;
    draft: Record<string, unknown>;
    editing: boolean;
    onEdit: (sectionIndex: number) => void;
    readOnly?: boolean;
}) {
    return (
        <div data-component={dataComponent} data-slot="review" className="review">
            {REVIEW_SECTIONS.map((section, sectionIndex) => (
                <section data-component={`${dataComponent}_section`} data-slot="review-section" className="review-section" key={section.id}>
                    <div data-component={`${dataComponent}_section_header`} data-slot="sec-head" className="sec-head">
                        <span data-slot="tag" className={`tag ${section.tone === "finish" ? "etc" : section.tone}`}>{section.title}</span>
                        {editing && !readOnly && (
                            <button
                                type="button"
                                data-slot="sec-edit"
                                className="sec-edit"
                                data-component={`${dataComponent}_section_header_edit`}
                                onClick={() => onEdit(sectionIndex)}
                            >
                                수정
                            </button>
                        )}
                    </div>
                    {section.fields.map((field) => (
                        <ReviewFieldRow key={field.key} dataComponent={dataComponent} field={field} draft={draft} />
                    ))}
                </section>
            ))}
        </div>
    );
}

function ReviewFieldRow({
    dataComponent,
    field,
    draft,
}: {
    dataComponent: string;
    field: (typeof DAILY_ITEMS)[number];
    draft: Record<string, unknown>;
}) {
    const display = formatReviewFieldValue(field, draft);
    const isText = field.type === "textarea";
    const valueClassName = display.value ? (display.ok ? "ok" : "") : "empty";
    const value = display.value || REVIEW_EMPTY_LABEL;

    if (isText) {
        return (
            <div data-component={`${dataComponent}_section_note`} data-slot="review-note" className="review-note">
                <span>{field.label}</span>
                <b className={valueClassName}>{value}</b>
            </div>
        );
    }

    return (
        <div data-component={`${dataComponent}_section_row`} data-slot="review-row" className="review-row">
            <span>{field.label}</span>
            <b className={valueClassName}>{value}</b>
        </div>
    );
}

function renderSignature(
    signature: ServiceRecordWizardSlots["signature"],
    props: SignatureSlotProps,
): ReactNode {
    if (typeof signature !== "function") return null;
    return signature(props);
}

function isValidDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

export function ServiceRecordWizard({
    "data-component": dataComponent,
    screen,
    phone,
    phoneError,
    phoneFieldError,
    context,
    header,
    day,
    pageIdx,
    draft,
    editing,
    readOnly = false,
    adminMode = false,
    headerErrors: suppliedHeaderErrors,
    changedSessionIndexes,
    clientSignature,
    busy,
    isRecordFinalized,
    lockedDays,
    nextOpenDay,
    scheduleChangeBusy,
    hasServiceDateMismatch,
    defaultDate,
    onPhoneChange,
    onSubmitPhone,
    onBack,
    onHeaderChange,
    onDeliveryTypeChange,
    onSaveHeader,
    onOpenDay,
    onOpenScheduleChangePreview,
    onOpenServiceDateEditor,
    onServiceDateChange,
    onFieldChange,
    onToggleMulti,
    onSignatureChange,
    onNextPage,
    onOpenSubmitModal,
    onEditSection,
    slots,
}: ServiceRecordWizardProps) {
    const child = (suffix: string) => `${dataComponent}_${suffix}`;
    const [touchedHeader, setTouchedHeader] = useState<Partial<Record<ServiceRecordHeaderValidationKey, boolean>>>({});
    const [focusedHeader, setFocusedHeader] = useState<ServiceRecordHeaderValidationKey | null>(null);
    const [headerSubmitted, setHeaderSubmitted] = useState(false);
    const [phoneFocused, setPhoneFocused] = useState(false);
    const [phoneTouched, setPhoneTouched] = useState(false);
    const [phoneSubmitted, setPhoneSubmitted] = useState(false);
    const [serviceDateFocused, setServiceDateFocused] = useState(false);
    const [serviceDateTouched, setServiceDateTouched] = useState(false);
    const [serviceDateEdit, setServiceDateEdit] = useState<{ text: string; base: string; day: number } | null>(null);
    const [submittedPageKey, setSubmittedPageKey] = useState<string | null>(null);
    // "Held a value before" flags live in refs so a prefilled value that is later cleared shows "required".
    const hadHeaderValue = useRef<Partial<Record<ServiceRecordHeaderValidationKey, boolean>>>({});
    const hadPhoneValue = useRef(false);
    const hadServiceDateValue = useRef(false);
    const touchHeader = (key: ServiceRecordHeaderValidationKey) => setTouchedHeader((current) => ({ ...current, [key]: true }));
    // Only an administrator editor with an explicit patch error map owns validation scope.
    // Employee forms and callers without that map still validate the complete header.
    const usesScopedHeaderErrors = adminMode && suppliedHeaderErrors !== undefined;
    const headerErrors = usesScopedHeaderErrors ? (suppliedHeaderErrors ?? {}) : {
        ...suppliedHeaderErrors,
        ...getServiceRecordHeaderErrors(header, new Date(), { required: !adminMode }),
    };
    for (const key of SERVICE_RECORD_HEADER_KEYS) {
        if (hasDisplayValue(header[key])) hadHeaderValue.current[key] = true;
    }
    const headerFieldMessage = (key: ServiceRecordHeaderValidationKey): SlotMessage | null => {
        if (readOnly) return null;
        const value = header[key] ?? "";
        const state: FieldInputState = {
            value,
            hadValue: Boolean(hadHeaderValue.current[key]),
            touched: Boolean(touchedHeader[key]),
            focused: focusedHeader === key,
        };
        const isDate = HEADER_DATE_KEYS.includes(key);
        const label = HEADER_REQUIRED_LABEL[key];
        const active = focusedHeader === key || state.touched || headerSubmitted;
        // Nothing shows for a value the user has not interacted with yet.
        const resolved = value === "" || active
            ? resolveFieldMessage(isDate ? "date" : "text", state, { required: !adminMode, submitted: headerSubmitted })
            : null;
        if (resolved && !(adminMode && resolved.tone === "error")) {
            return fieldMessageToSlot(resolved, { label, choice: key === "deliveryType" });
        }
        if (value === "") return null;
        const supplied = suppliedHeaderErrors?.[key];
        if (supplied) return errorMessage(supplied);
        const computed = (adminMode || active) ? headerErrors[key] : undefined;
        return computed ? errorMessage(computed) : null;
    };
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneComplete = phoneDigits.length >= PHONE_DIGITS_REQUIRED;
    if (phone !== "") hadPhoneValue.current = true;
    const phoneFormatMessage = fieldMessageToSlot(
        resolveFieldMessage("phone", {
            value: phone === "" ? "" : phoneComplete ? PHONE_COMPLETE_PROBE : PHONE_INCOMPLETE_PROBE,
            hadValue: hadPhoneValue.current,
            touched: phoneTouched,
            focused: phoneFocused,
        }, { required: true, submitted: phoneSubmitted }),
        { label: "휴대폰 번호" },
    );
    // One slot, one message: a format error beats the caller's field error, which beats a hint.
    const phoneMessage: SlotMessage | null = phoneFormatMessage?.tone === "error"
        ? phoneFormatMessage
        : phoneFieldError ? errorMessage(phoneFieldError) : phoneFormatMessage;
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const adminEditing = adminMode && !readOnly;
    const currentSession = context?.sessions.find((session) => session.sessionIndex === day);
    const plannedDateVectorProvided = context?.plannedSessionDates !== undefined;
    const plannedDateVector = context?.plannedSessionDates;
    const plannedDateVectorValid = !plannedDateVectorProvided || (
        Array.isArray(plannedDateVector)
        && plannedDateVector.length === (context?.totalSessions ?? 0)
        && new Set(plannedDateVector.map((session) => session.sessionIndex)).size === plannedDateVector.length
        && new Set(plannedDateVector.map((session) => session.serviceDate)).size === plannedDateVector.length
        && plannedDateVector.every((session) => (
                Number.isSafeInteger(session.sessionIndex)
                && session.sessionIndex > 0
                && session.sessionIndex <= (context?.totalSessions ?? 0)
                && isValidDateOnly(session.serviceDate)
            ))
    );
    const plannedDateBySession = plannedDateVectorValid
        ? new Map(plannedDateVector?.map((session) => [session.sessionIndex, session.serviceDate]))
        : null;
    const plannedServiceDate = plannedDateBySession?.get(day);
    const providerDateLocked = !adminMode && plannedDateVectorProvided;
    const currentServiceDate = (providerDateLocked ? plannedServiceDate : undefined)
        || (draft._date as string | undefined)
        || currentSession?.serviceDate?.slice(0, 10)
        || plannedServiceDate
        || (plannedDateVectorProvided ? "" : defaultDate(day));
    const isMomConfirmationPage = Boolean(currentDayPage.confirmation);
    const signatureValue = currentSession?.clientSignature ?? clientSignature;
    const isSignatureLocked = Boolean(currentSession?.clientSignature);
    const isHeaderComplete = (usesScopedHeaderErrors
        ? hasServiceRecordHeaderValues(header)
        : isServiceRecordHeaderComplete(header)) && Object.keys(headerErrors).length === 0;
    const numericErrors = getServiceRecordNumericErrors(draft);
    const hasInvalidNumericAnswers = Object.keys(numericErrors).length > 0;
    const hasInvalidTextAnswers = DAILY_ITEMS.some((item) => item.type === "textarea"
        && item.maxLength !== undefined && typeof draft[item.key] === "string"
        && (draft[item.key] as string).length > item.maxLength);
    const plannedDateForSession = (sessionIndex: number): string | undefined => plannedDateBySession?.get(sessionIndex);
    const displayDateForSession = (sessionIndex: number, session?: { serviceDate: string }): string => (
        session?.serviceDate?.slice(0, 10)
        || plannedDateForSession(sessionIndex)
        || (plannedDateVectorProvided ? "" : defaultDate(sessionIndex))
    );
    const dailyFieldComponent = (item: (typeof DAILY_ITEMS)[number]): string => child(`body_day-field_${dailyFieldSuffix(item.key)}`);
    const currentPageKey = `${day}:${pageIdx}`;
    const daySubmitted = submittedPageKey === currentPageKey;
    // The service date is typed as YYYY-MM-DD; state stays ISO and only a complete valid date is reported.
    const serviceDateMin = day <= 1 ? (context?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day);
    const serviceDateText = serviceDateEdit && serviceDateEdit.base === currentServiceDate && serviceDateEdit.day === day
        ? serviceDateEdit.text : null;
    const serviceDateValue = serviceDateText ?? currentServiceDate;
    if (serviceDateValue !== "") hadServiceDateValue.current = true;
    const serviceDateIsReportable = (text: string): boolean => (
        isRealIsoDate(text) && (!serviceDateMin || text >= serviceDateMin)
    );
    const serviceDateBlocked = serviceDateText !== null && !serviceDateIsReportable(serviceDateText);
    const serviceDateMessage = serviceDateText === null ? null : fieldMessageToSlot(
        resolveFieldMessage("date", {
            value: serviceDateText,
            hadValue: hadServiceDateValue.current,
            touched: serviceDateTouched,
            focused: serviceDateFocused,
        }, {
            required: true,
            submitted: daySubmitted,
            dateRange: serviceDateMin ? { notBefore: serviceDateMin } : undefined,
        }),
        { label: "제공일자", rangeText: FIELD_COPY.serviceDateBefore },
    );
    const serviceDateFieldVisible = screen === "day" && !readOnly && !adminMode && !editing && pageIdx === 0;
    // A date that differs from today is a caution about this field: it sits in the field's slot
    // (below any error or format hint) while the field is on screen.
    const serviceDateSlot: SlotMessage | null = serviceDateMessage
        ?? (serviceDateFieldVisible && hasServiceDateMismatch ? hintMessage(FIELD_COPY.serviceDateMismatch) : null);
    const firstDayProblemId = (): string | null => {
        if (serviceDateFieldVisible && serviceDateBlocked) return SERVICE_DATE_INPUT_ID;
        for (const index of currentDayPage.items) {
            const item = DAILY_ITEMS[index];
            if (!item) continue;
            const problemId = getDailyItemProblemId(item, dailyFieldComponent(item), draft, numericErrors);
            if (problemId) return problemId;
        }
        return null;
    };
    const hasInvalidNumericAnswersOnCurrentPage = currentDayPage.items.some((index) => {
        const item = DAILY_ITEMS[index];
        return item?.type === "counts"
            && (item.counts ?? []).some((count) => numericErrors[`${item.key}_${count.k}`]);
    });
    const renderServiceDateDisplay = (
        sessionIndex: number,
        serviceDate: string,
        suffix: string,
        fallback = formatShortDate(serviceDate),
    ): ReactNode => slots?.serviceDateDisplay?.({
        "data-component": child(suffix),
        sessionIndex,
        serviceDate,
    }) ?? fallback;
    const progress = screen === "done"
        ? 100
        : screen === "day"
            ? 20 + Math.round(((pageIdx + 1) / DAY_PAGES.length) * 70)
            : screen === "overview"
                ? 20
                : screen === "service"
                    ? 12
                    : 5;

    const handleHeaderInput = (key: ServiceRecordHeaderValidationKey, raw: string) => {
        onHeaderChange(key, HEADER_DATE_KEYS.includes(key) ? formatIsoDateInput(raw) : raw);
    };
    const handleServiceDateInput = (raw: string) => {
        if (providerDateLocked) return;
        const next = formatIsoDateInput(raw);
        setServiceDateEdit({ text: next, base: currentServiceDate, day });
        if (next.length === 10 && serviceDateIsReportable(next)) onServiceDateChange(next);
    };
    const handleServiceDateBlur = () => {
        setServiceDateFocused(false);
        if (serviceDateText === null) return;
        if (serviceDateText !== "") setServiceDateTouched(true);
        // A date that was handed to the caller is shown from the caller's state again.
        if (serviceDateIsReportable(serviceDateText)) setServiceDateEdit(null);
    };
    const handleSubmitPhone = () => {
        setPhoneSubmitted(true);
        if (!phoneComplete) {
            focusFirstProblem(PHONE_INPUT_ID);
            return;
        }
        void onSubmitPhone();
    };
    const handleSaveHeader = () => {
        if (readOnly || busy) return;
        setHeaderSubmitted(true);
        if (isHeaderComplete) {
            void onSaveHeader();
            return;
        }
        const firstProblem = SERVICE_RECORD_HEADER_KEYS.find((key) => headerErrors[key]);
        focusFirstProblem(firstProblem ? `service-record-header-${firstProblem}` : null);
    };
    const handleNextPage = () => {
        if (readOnly || adminMode) {
            onNextPage();
            return;
        }
        const problemId = firstDayProblemId();
        if (problemId) {
            setSubmittedPageKey(currentPageKey);
            focusFirstProblem(problemId);
            return;
        }
        onNextPage();
    };
    const handlePhoneChange = (event: ChangeEvent<HTMLInputElement>) => onPhoneChange(event.target.value);

    return (
        <div data-component={dataComponent} data-slot="srec" data-source-component="ServiceRecordWizard" className="srec">
            <div data-component={child(COMPONENT_SUFFIX.topBar)} data-slot="top" className="top">
                <h1>산모·신생아 건강관리 서비스 제공기록지</h1>
                <div data-component={child("top-bar_meta")} data-slot="top-meta" className="top-meta">
                    {slots?.provider?.({
                        "data-component": child("top-bar_meta_provider-name"),
                        providerName: context?.org?.name,
                    })}
                    <div data-component={child("top-bar_meta_crumbs")} data-slot="crumbs" className="crumbs">
                        {screen === "phone" && <>1단계 · <b>본인 확인</b></>}
                        {screen === "service" && <>2단계 · <b>서비스 기본정보</b></>}
                        {screen === "overview" && <>3단계 · <b>일자별 기록</b></>}
                        {screen === "day" && <><b>{day}회차</b> · {currentDayPage.title} ({pageIdx + 1}/{DAY_PAGES.length})</>}
                        {screen === "done" && <b>최종 제출 완료</b>}
                    </div>
                </div>
                <div data-component={child("top-bar_progress")} data-slot="bar" className="bar"><i style={{ width: `${progress}%` }} /></div>
                {adminMode && slots?.adminToolbar ? (
                    <div data-component={child("top-bar_admin-toolbar")} data-slot="admin-toolbar" className="admin-draft-toolbar">
                        {slots.adminToolbar}
                    </div>
                ) : null}
            </div>
            <div data-component={child(COMPONENT_SUFFIX.body)} data-slot="body" className={`body ${screen === "done" ? "completion-body" : ""}`}>
                {screen === "loading" && <p data-slot="muted" className="muted">불러오는 중…</p>}
                {context && plannedDateVectorProvided && !plannedDateVectorValid ? (
                    <p data-component={child("body_planned-date-error")} data-slot="error" className="err" role="alert">
                        서버 일정 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.
                    </p>
                ) : null}

                {screen === "invalid" && (
                    <div data-component={child("body_invalid-center")} data-slot="center" className="center">
                        <div data-component={child("body_invalid-center_title")} data-slot="step-title" className="step-title">링크를 사용할 수 없습니다</div>
                        <p data-slot="muted" className="muted">만료되었거나 더 이상 유효하지 않은 링크입니다. 지점에 문의해 주세요.</p>
                    </div>
                )}

                {screen === "phone" && (
                    <>
                        <div data-component={child("body_phone-title")} data-slot="step-title" className="step-title">제공인력 본인 확인</div>
                        <p data-slot="muted" className="muted">본인 휴대폰 번호를 입력하면 서비스 기간 동안 유효한 접근 권한이 발급됩니다.</p>
                        {phoneError ? (
                            <p data-component={child("body_phone-error")} data-slot="error" className="err" role="alert">{phoneError}</p>
                        ) : null}
                        <FieldLabelRow
                            dataComponent={child("body_phone-input")}
                            label="휴대폰 번호"
                            htmlFor={PHONE_INPUT_ID}
                            slotId="service-record-phone-helper"
                            message={phoneMessage}
                        />
                        <TextInput
                            id={PHONE_INPUT_ID}
                            data-component={child("body_phone-input")}
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            maxLength={13}
                            placeholder="010-1234-5678"
                            aria-describedby="service-record-phone-helper"
                            aria-invalid={phoneMessage?.tone === "error" ? "true" : undefined}
                            value={phone}
                            onFocus={() => setPhoneFocused(true)}
                            onBlur={() => { setPhoneFocused(false); if (phone !== "") setPhoneTouched(true); }}
                            onChange={handlePhoneChange}
                        />
                        <button data-component={child("body_phone-submit")} data-slot="btn" className="btn primary" disabled={busy} onClick={handleSubmitPhone}>{busy ? "확인 중…" : "확인하기"}</button>
                    </>
                )}

                {screen === "service" && context && (
                    <>
                        <button data-component={child("body_service-back")} data-slot="text-back" className="text-back" type="button" onClick={onBack}>이전</button>
                        <div data-component={child("body_service-title")} data-slot="step-title" className="step-title">서비스 기본정보</div>
                        <div data-component={child("body_readonly-row")} data-slot="ro" className="ro"><span>제공인력</span><b>{context.employee?.name ?? "정보 없음"}</b></div>
                        <div data-component={child("body_readonly-row-2")} data-slot="ro" className="ro"><span>제공기관</span><b>{context.org?.name ?? "인천 아이미래로"}</b></div>
                        {(["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"] as const).map((key) => {
                            const inputId = `service-record-header-${key}`;
                            const slotId = `${inputId}-error`;
                            const message = headerFieldMessage(key);
                            if (key === "deliveryType") {
                                const deliveryComponent = child("body_delivery-field_options");
                                return (
                                    <div data-component={child("body_delivery-field")} data-slot="fld" className="fld" key={key}>
                                        <FieldLabelRow dataComponent={deliveryComponent} label="분만형태" slotId={slotId} message={message} />
                                        <FieldOptions
                                            dataComponent={deliveryComponent}
                                            options={["자연분만", "제왕절개"]}
                                            selected={(option) => header.deliveryType === option}
                                            onSelect={(value) => { touchHeader("deliveryType"); onDeliveryTypeChange(value); }}
                                            radio
                                            disabled={readOnly}
                                            firstOptionId={inputId}
                                            describedBy={slotId}
                                        />
                                    </div>
                                );
                            }
                            const field = HEADER_FIELDS.find((candidate) => candidate.k === key);
                            if (!field) return null;
                            const inputComponent = key === "babyWeight"
                                ? child("body_field-2_baby-weight-input")
                                : child(`body_field_${HEADER_FIELD_COMPONENT_SUFFIX[key]}-input`);
                            return (
                                <div data-component={inputComponent} data-slot="fld" className="fld" key={key}>
                                    <FieldLabelRow dataComponent={inputComponent} label={field.label} htmlFor={inputId} slotId={slotId} message={message} />
                                    <TextInput
                                        id={inputId}
                                        data-component={`${inputComponent}_control`}
                                        placeholder={field.ph}
                                        inputMode={field.inputMode}
                                        maxLength={HEADER_DATE_KEYS.includes(key) ? 10 : undefined}
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-required={!readOnly && !adminMode}
                                        onFocus={() => setFocusedHeader(key)}
                                        onBlur={() => { setFocusedHeader(null); if (header[key]) touchHeader(key); }}
                                        value={header[key] ?? ""}
                                        disabled={readOnly}
                                        aria-invalid={message?.tone === "error" ? "true" : undefined}
                                        aria-describedby={slotId}
                                        onChange={(event) => handleHeaderInput(key, event.target.value)}
                                    />
                                </div>
                            );
                        })}
                        {adminMode && slots?.adminHeaderAction ? slots.adminHeaderAction({ isHeaderComplete, headerErrors }) : (
                            // Employees can press "다음" any time: a blocked press shows every problem in its slot.
                            <button data-slot="btn" className="btn primary" disabled={readOnly || busy || (adminMode && !isHeaderComplete)} onClick={handleSaveHeader}>{busy ? "저장 중…" : adminMode ? "초안 저장" : "다음"}</button>
                        )}
                    </>
                )}

                {screen === "overview" && context && (
                    <>
                        <div data-component={child("body_overview-title")} data-slot="step-title" className="step-title">제공기록표</div>
                        <p data-component={child("body_overview-help")} data-slot="muted" className="muted">{readOnly ? "조회 전용 기록입니다. 회차를 선택해 내용을 확인하세요." : "제출된 기록은 눌러서 수정할 수 있습니다."}</p>
                        <div data-component={child("body_day-grid")} data-slot="days" className="days">
                            {Array.from({ length: context.totalSessions }, (_, index) => index + 1).map((sessionIndex) => {
                                const session = context.sessions.find((row) => row.sessionIndex === sessionIndex);
                                const done = lockedDays.has(sessionIndex);
                                const open = sessionIndex === nextOpenDay();
                                const changed = Boolean(changedSessionIndexes?.has(sessionIndex));
                                const serviceDate = displayDateForSession(sessionIndex, session);
                                const className = adminEditing
                                    ? `day ${changed ? "current draft-changed" : "readonly"}`
                                    : done ? "day done" : readOnly ? "day readonly" : open ? "day current" : "day locked";
                                return (
                                    <button
                                        type="button"
                                        key={sessionIndex}
                                        data-slot="day"
                                        className={className}
                                        disabled={adminEditing ? false : ((!readOnly && !done && !open) || (!readOnly && isRecordFinalized))}
                                        onClick={() => onOpenDay(sessionIndex, done)}
                                    >
                                        <div data-component={child("body_day-grid_day_date")} data-slot="day-date" className="d">
                                            {renderServiceDateDisplay(
                                                sessionIndex,
                                                serviceDate,
                                                "body_day-grid_day_date-display",
                                                formatShortDate(serviceDate),
                                            )}
                                        </div>
                                        <div data-component={child("body_day-grid_day_number")} data-slot="day-number" className="n">{sessionIndex}</div>
                                        <div data-component={child("body_day-grid_day_status")} data-slot="day-status" className="st">
                                            {adminEditing ? (changed ? "초안 변경" : done ? "제출완료" : "편집 가능") : done ? "제출완료" : readOnly ? "조회 가능" : open ? "입력 가능" : "대기"}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {(readOnly || adminMode) && slots?.overviewSupplemental}
                        {adminMode && slots?.adminConfirmAction ? (
                            <div data-component={child("body_overview-actions")} data-slot="overview-actions" className="overview-actions">
                                {slots.adminConfirmAction}
                            </div>
                        ) : null}
                        {!readOnly && !adminMode && lockedDays.size < context.totalSessions && (
                            <div data-component={child("body_overview-actions")} data-slot="overview-actions" className="overview-actions">
                                <button data-slot="btn" className="btn primary" disabled={isRecordFinalized} onClick={() => onOpenDay(nextOpenDay())}>{lockedDays.size ? "다음 회차 입력" : "기록 시작"}</button>
                                <button
                                    data-slot="btn"
                                    className="btn ghost schedule-change"
                                    disabled={isRecordFinalized || scheduleChangeBusy || Boolean(context.pendingScheduleChange)}
                                    onClick={() => onOpenScheduleChangePreview()}
                                >
                                    {context.pendingScheduleChange ? "일정 변경 요청 대기 중" : "서비스 일정 변경"}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {screen === "day" && (
                    <>
                        <button
                            data-component={child("body_day-back")}
                            data-slot="text-back"
                            className="text-back"
                            type="button"
                            onClick={onBack}
                        >
                            이전
                        </button>
                        <div data-slot="date-row" className={adminMode ? "date-row" : undefined}>
                            <div data-component={child("body_date-chip")} data-slot="datechip" className="datechip">
                                {day}회차{editing ? " · " : ""}
                                {editing
                                    ? renderServiceDateDisplay(
                                        day,
                                        currentServiceDate,
                                        "body_date-chip_date-display",
                                        formatMonthDayKo(currentServiceDate),
                                    )
                                    : null}
                            </div>
                            {adminMode && slots?.serviceDateEditor ? slots.serviceDateEditor({
                                "data-component": child("body_date-edit"),
                                sessionIndex: day,
                                serviceDate: currentServiceDate,
                                disabled: readOnly || busy,
                                onOpen: () => onOpenServiceDateEditor?.(day),
                            }) : null}
                        </div>
                        {!readOnly && !adminMode && !editing && pageIdx === 0 && (
                            <div data-component={child("body_service-date-field")} data-slot="fld" className="fld">
                                <FieldLabelRow
                                    dataComponent={child("body_service-date-field_date-input")}
                                    label="제공일자"
                                    htmlFor={SERVICE_DATE_INPUT_ID}
                                    slotId="service-record-date-helper"
                                    message={serviceDateSlot}
                                />
                                <TextInput
                                    id={SERVICE_DATE_INPUT_ID}
                                    data-component={child("body_service-date-field_date-input")}
                                    aria-describedby="service-record-date-helper"
                                    aria-invalid={serviceDateMessage?.tone === "error" ? "true" : undefined}
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    maxLength={10}
                                    placeholder={SERVICE_DATE_PLACEHOLDER}
                                    className="dateinput"
                                    disabled={providerDateLocked}
                                    value={serviceDateValue}
                                    onFocus={() => setServiceDateFocused(true)}
                                    onBlur={handleServiceDateBlur}
                                    onChange={(event) => handleServiceDateInput(event.target.value)}
                                />
                                {providerDateLocked ? (
                                    <>
                                        <p data-component={child("body_service-date-field_schedule-help")} data-slot="muted" className="muted">
                                            제공일자를 바꾸려면 일정 변경을 요청해 주세요.
                                        </p>
                                        <button
                                            data-component={child("body_service-date-field_schedule-change")}
                                            data-slot="btn"
                                            className="btn ghost"
                                            type="button"
                                            disabled={isRecordFinalized || scheduleChangeBusy || Boolean(context?.pendingScheduleChange)}
                                            onClick={() => onOpenScheduleChangePreview()}
                                        >
                                            {context?.pendingScheduleChange ? "일정 변경 요청 대기 중" : "서비스 일정 변경"}
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        )}
                        {/* Where no date field is on the page (later pages, admin edit) the date's caution still lives in a field slot: a compact read-only row. */}
                        {!readOnly && (!editing || adminMode) && hasServiceDateMismatch && !serviceDateFieldVisible && (
                            <div data-component={child("body_service-date-readonly")} data-slot="fld" className="fld">
                                <FieldLabelRow
                                    dataComponent={child("body_service-date-readonly_date")}
                                    label="서비스 제공일자"
                                    slotId="service-record-date-readonly-helper"
                                    message={hintMessage(FIELD_COPY.serviceDateMismatch)}
                                />
                                <div data-component={child("body_service-date-readonly_value")} data-slot="ro" className="ro">
                                    <b>{currentServiceDate}</b>
                                </div>
                            </div>
                        )}
                        <div data-component={child("body_day-title")} data-slot="step-title" className="step-title">{currentDayPage.title}</div>
                        {isMomConfirmationPage ? (
                            <>
                                {editing && !adminMode && (
                                    <div data-component={child("body_resign-notice")} data-slot="notice" className="notice">
                                        <span>이미 제출된 회차입니다.</span>
                                    </div>
                                )}
                                <div data-component={child("body_handover-banner")} data-slot="handover" className="handover">
                                    <b>{adminMode ? "관리자 수정 내용을 확인해 주세요." : "최종 기록을 확인해 주세요."}</b>
                                </div>
                                <MomConfirmationReview
                                    dataComponent={child("body_review")}
                                    draft={draft}
                                    editing={editing}
                                    onEdit={onEditSection}
                                    readOnly={readOnly}
                                />
                                {renderSignature(slots?.signature, {
                                    "data-component": child("body_mom-sign"),
                                    value: signatureValue,
                                    signedAt: currentSession?.clientSignedAt ?? null,
                                    onChange: onSignatureChange,
                                    locked: isSignatureLocked,
                                })}
                            </>
                        ) : (
                            <>
                                {currentDayPage.items.map((index) => {
                                    const item = DAILY_ITEMS[index];
                                    if (!item) return null;
                                    return (
                                        <div data-component={dailyFieldComponent(item)} data-slot="fld" className="fld" key={item.key}>
                                            <DailyField
                                                dataComponent={dailyFieldComponent(item)}
                                                item={item}
                                                draft={draft}
                                                onFieldChange={onFieldChange}
                                                onToggleMulti={onToggleMulti}
                                                readOnly={readOnly}
                                                numericErrors={numericErrors}
                                                submitted={daySubmitted}
                                                requireAnswers={!adminMode && !readOnly}
                                            />
                                        </div>
                                    );
                                })}
                            </>
                        )}
                        {isMomConfirmationPage ? (
                            <div data-component={child("body_confirmation-action")} data-slot="nav" className="nav confirmation-nav">
                                {adminMode && slots?.adminSessionAction
                                    ? typeof slots.adminSessionAction === "function"
                                        ? slots.adminSessionAction({ hasInvalidNumericAnswers })
                                        : slots.adminSessionAction
                                    : <button data-slot="btn" className="btn submit" disabled={readOnly || busy || (!adminMode && !signatureValue) || hasInvalidNumericAnswers || hasInvalidTextAnswers} onClick={onOpenSubmitModal}>{readOnly ? "조회 전용" : adminMode ? (busy ? "저장 중…" : "초안 저장") : "확인"}</button>}
                            </div>
                        ) : (
                            <div data-component={child("body_nav")} data-slot="nav" className="nav">
                                <button
                                    data-slot="btn"
                                    className="btn primary"
                                    disabled={!readOnly && adminMode && hasInvalidNumericAnswersOnCurrentPage}
                                    onClick={handleNextPage}
                                >
                                    {readOnly || adminMode ? "다음" : editing ? "저장" : "다음"}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {screen === "done" && (
                    <div data-component={child("body_done-center")} data-slot="center" className="center">
                        <span data-component={child("body_done-center_icon")} data-slot="completion-icon" className="completion-icon" aria-hidden="true">✅</span>
                        <h2 data-component={child("body_done-center_title")} data-slot="completion-title" className="completion-title">제공기록지 제출이 완료되었습니다.</h2>
                    </div>
                )}
            </div>
            {slots?.submitModal}
            {slots?.scheduleChangeModal}
            {slots?.serviceDateChangeModal}
            {slots?.errorNotification}
        </div>
    );
}
