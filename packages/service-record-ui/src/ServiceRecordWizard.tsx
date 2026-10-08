"use client";

import { useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { formatIsoDateInput } from "../../shared/src/utils/date-input";
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
    hasDisplayValue,
    type ServiceRecordHeaderValidationKey,
    type ServiceRecordNumericErrors,
} from "./form-definition";
import {
    FIELD_COPY,
    type SlotMessage,
} from "./field-messages";
import {
    HEADER_DATE_KEYS,
    firstHeaderProblemKey,
    focusFirstProblem,
    getDailyItemMessages,
    getFirstDayPageProblem,
    getHeaderFieldMessage,
    getPhoneState,
    getServiceDateMessage,
    getServiceDateMin,
    getWizardProgress,
    hasInvalidNumericAnswersOnPage,
    hasInvalidTextAnswers as hasInvalidTextAnswersIn,
    hintMessage,
    resolveHeaderErrors,
    resolvePlannedDates,
    useHadValue,
    type DailyItemProblem,
} from "./headless";
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
    labelId,
    slotId,
    message,
}: {
    dataComponent: string;
    label: string;
    htmlFor?: string;
    labelId?: string;
    slotId: string;
    message: SlotMessage | null;
}) {
    return (
        <div data-component={`${dataComponent}_label-row`} data-slot="lab-row" className="lab-row">
            <label id={labelId} data-slot="lab" className="lab" htmlFor={htmlFor}>{label}</label>
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
    labelId,
}: {
    dataComponent: string;
    options: string[];
    selected: (option: string) => boolean;
    onSelect: (option: string) => void;
    radio?: boolean;
    disabled?: boolean;
    firstOptionId?: string;
    describedBy?: string;
    labelId?: string;
}) {
    return (
        <div data-component={dataComponent} data-slot="opts" className="opts" role={radio ? "radiogroup" : "group"} aria-labelledby={labelId}>
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

/** A count input whose label is not already part of its item's label needs the item name to be unambiguous (모유수유 횟수 vs 분유수유 횟수). */
const countAccessibleName = (itemLabel: string, countLabel: string): string => {
    const plainItemLabel = itemLabel.replace(/^[①-⑳]\s*/u, "").trim();
    return plainItemLabel.includes(countLabel) ? countLabel : `${plainItemLabel} ${countLabel}`;
};

const dailyFieldSuffix = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const countInputId = (dataComponent: string, countKey: string): string => `${dataComponent}_count-options_${countKey}-input-control`;
const firstOptionIdOf = (dataComponent: string): string => `${dataComponent}-first-option`;
const stoolColorInputId = (dataComponent: string): string => `${dataComponent}-stool-color`;
const textareaInputId = (dataComponent: string, itemKey: string): string => `${dataComponent}-${itemKey === "etcService" ? "etc-service" : "notes"}`;

/** DOM id of the control a headless problem descriptor points at, or null when the item is fine. */
function getDailyItemProblemId(
    item: (typeof DAILY_ITEMS)[number],
    dataComponent: string,
    problem: DailyItemProblem | null,
): string | null {
    if (!problem) return null;
    switch (problem.kind) {
        case "textarea": return textareaInputId(dataComponent, item.key);
        case "count": return countInputId(dataComponent, problem.countKey);
        case "stoolColor": return stoolColorInputId(dataComponent);
        case "option": return firstOptionIdOf(dataComponent);
    }
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
    const labelId = `${slotId}-label`;
    const [textFocused, setTextFocused] = useState(false);
    // A "required" message only appears once the field held a value and was cleared (or after submit).
    // Every key is tracked on every render, before any message reads the flags.
    const track = useHadValue();
    const hadMain = track(item.key, value);
    const hadColor = track(`${item.key}_color`, draft[`${item.key}_color`]);
    const hadCounts: Record<string, boolean> = {};
    for (const count of item.counts ?? []) {
        const fieldKey = `${item.key}_${count.k}`;
        hadCounts[fieldKey] = track(fieldKey, draft[fieldKey]);
    }
    const { message, invalidCountKeys, stoolColorMessage: colorMessage } = getDailyItemMessages(item, draft, {
        submitted,
        requireAnswers,
        readOnly,
        textFocused,
        numericErrors,
        had: { main: hadMain, color: hadColor, counts: hadCounts },
    });
    const hasError = message?.tone === "error";
    const labelRow = (
        <FieldLabelRow
            dataComponent={dataComponent}
            label={item.label}
            htmlFor={item.type === "textarea" ? textareaInputId(dataComponent, item.key) : undefined}
            labelId={labelId}
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
                    labelId={labelId}
                />
            </>
        );
    }

    if (item.type === "radio" || item.type === "stool") {
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
                    labelId={labelId}
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
                                        aria-label={countAccessibleName(item.label, count.label)}
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
                    labelId={labelId}
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
                <section
                    data-component={`${dataComponent}_section`}
                    data-slot="review-section"
                    className="review-section"
                    key={section.id}
                    aria-labelledby={`${dataComponent}_section_${section.id}-title`}
                >
                    <div data-component={`${dataComponent}_section_header`} data-slot="sec-head" className="sec-head">
                        <span id={`${dataComponent}_section_${section.id}-title`} data-slot="tag" className={`tag ${section.tone === "finish" ? "etc" : section.tone}`}>{section.title}</span>
                        {editing && !readOnly && (
                            <button
                                type="button"
                                data-slot="sec-edit"
                                className="sec-edit"
                                data-component={`${dataComponent}_section_header_edit`}
                                aria-label={`${section.title} 수정`}
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
    const labelId = `${dataComponent}_section_${field.key}-label`;

    if (isText) {
        return (
            <div data-component={`${dataComponent}_section_note`} data-slot="review-note" className="review-note" role="group" aria-labelledby={labelId}>
                <span id={labelId}>{field.label}</span>
                <b className={valueClassName}>{value}</b>
            </div>
        );
    }

    return (
        <div data-component={`${dataComponent}_section_row`} data-slot="review-row" className="review-row" role="group" aria-labelledby={labelId}>
            <span id={labelId}>{field.label}</span>
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
    const { headerErrors, isHeaderComplete } = resolveHeaderErrors(header, {
        adminMode,
        suppliedHeaderErrors,
        now: new Date(),
    });
    for (const key of SERVICE_RECORD_HEADER_KEYS) {
        if (hasDisplayValue(header[key])) hadHeaderValue.current[key] = true;
    }
    const headerFieldMessage = (key: ServiceRecordHeaderValidationKey): SlotMessage | null => getHeaderFieldMessage(key, {
        value: header[key] ?? "",
        hadValue: Boolean(hadHeaderValue.current[key]),
        touched: Boolean(touchedHeader[key]),
        focused: focusedHeader === key,
        submitted: headerSubmitted,
        adminMode,
        readOnly,
        suppliedHeaderErrors,
        headerErrors,
    });
    if (phone !== "") hadPhoneValue.current = true;
    const { complete: phoneComplete, message: phoneMessage } = getPhoneState(phone, {
        hadValue: hadPhoneValue.current,
        touched: phoneTouched,
        focused: phoneFocused,
        submitted: phoneSubmitted,
        phoneFieldError,
    });
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const adminEditing = adminMode && !readOnly;
    const {
        currentSession,
        plannedDateVectorProvided,
        plannedDateVectorValid,
        providerDateLocked,
        currentServiceDate,
        displayDateForSession,
    } = resolvePlannedDates({ context, day, adminMode, draft, defaultDate });
    const isMomConfirmationPage = Boolean(currentDayPage.confirmation);
    const signatureValue = currentSession?.clientSignature ?? clientSignature;
    const isSignatureLocked = Boolean(currentSession?.clientSignature);
    const numericErrors = getServiceRecordNumericErrors(draft);
    const hasInvalidNumericAnswers = Object.keys(numericErrors).length > 0;
    const hasInvalidTextAnswers = hasInvalidTextAnswersIn(draft);
    const dailyFieldComponent = (item: (typeof DAILY_ITEMS)[number]): string => child(`body_day-field_${dailyFieldSuffix(item.key)}`);
    const currentPageKey = `${day}:${pageIdx}`;
    const daySubmitted = submittedPageKey === currentPageKey;
    // The service date is typed as YYYY-MM-DD; state stays ISO and only a complete valid date is reported.
    const serviceDateMin = getServiceDateMin({ day, context, defaultDate });
    const serviceDateText = serviceDateEdit && serviceDateEdit.base === currentServiceDate && serviceDateEdit.day === day
        ? serviceDateEdit.text : null;
    const serviceDateValue = serviceDateText ?? currentServiceDate;
    if (serviceDateValue !== "") hadServiceDateValue.current = true;
    const serviceDateFieldVisible = screen === "day" && !readOnly && !adminMode && !editing && pageIdx === 0;
    const {
        reportable: serviceDateIsReportable,
        blocked: serviceDateBlocked,
        message: serviceDateMessage,
        slot: serviceDateSlot,
    } = getServiceDateMessage({
        text: serviceDateText,
        hadValue: hadServiceDateValue.current,
        touched: serviceDateTouched,
        focused: serviceDateFocused,
        submitted: daySubmitted,
        min: serviceDateMin,
        mismatch: hasServiceDateMismatch,
        fieldVisible: serviceDateFieldVisible,
    });
    const firstDayProblemId = (): string | null => {
        const problem = getFirstDayPageProblem(currentDayPage.items, draft, numericErrors, {
            serviceDateBlocked,
            serviceDateFieldVisible,
        });
        if (!problem) return null;
        if (problem.kind === "serviceDate") return SERVICE_DATE_INPUT_ID;
        return getDailyItemProblemId(problem.item, dailyFieldComponent(problem.item), problem.problem);
    };
    const hasInvalidNumericAnswersOnCurrentPage = hasInvalidNumericAnswersOnPage(currentDayPage.items, numericErrors);
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
    const progress = getWizardProgress(screen, pageIdx);

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
        const firstProblem = firstHeaderProblemKey(headerErrors);
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
                                        <FieldLabelRow dataComponent={deliveryComponent} label="분만형태" labelId={`${slotId}-label`} slotId={slotId} message={message} />
                                        <FieldOptions
                                            dataComponent={deliveryComponent}
                                            options={["자연분만", "제왕절개"]}
                                            selected={(option) => header.deliveryType === option}
                                            onSelect={(value) => { touchHeader("deliveryType"); onDeliveryTypeChange(value); }}
                                            radio
                                            disabled={readOnly}
                                            firstOptionId={inputId}
                                            describedBy={slotId}
                                            labelId={`${slotId}-label`}
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
                        {adminMode && slots?.adminCommitActions ? (
                            <div data-component={child("body_overview-commit")} data-slot="overview-commit" className="overview-commit">
                                {slots.adminCommitActions}
                            </div>
                        ) : null}
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
