"use client";

import { useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { formatBirthdayInput } from "../../shared/src/utils/birthday";
import "./field-help.css";

import {
    DAILY_ITEMS,
    DAY_PAGES,
    HEADER_FIELDS,
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
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
    babyBirth: "baby-birth", babyWeight: "baby-weight", deliveryType: "delivery-type",
} as const;

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

function FieldOptions({
    dataComponent,
    options,
    selected,
    onSelect,
    radio = false,
    disabled = false,
}: {
    dataComponent: string;
    options: string[];
    selected: (option: string) => boolean;
    onSelect: (option: string) => void;
    radio?: boolean;
    disabled?: boolean;
}) {
    return (
        <div data-component={dataComponent} data-slot="opts" className="opts">
            {options.map((option) => (
                <button
                    type="button"
                    key={option}
                    aria-pressed={selected(option)}
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

function DailyField({
    dataComponent,
    item,
    draft,
    onFieldChange,
    onToggleMulti,
    readOnly = false,
    numericErrors = {},
}: {
    dataComponent: string;
    item: (typeof DAILY_ITEMS)[number];
    draft: Record<string, unknown>;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    readOnly?: boolean;
    numericErrors?: ServiceRecordNumericErrors;
}) {
    const value = draft[item.key];
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const touch = (key: string) => setTouched((current) => ({ ...current, [key]: true }));

    if (item.type === "multi") {
        return (
            <>
                <FieldOptions
                    dataComponent={`${dataComponent}_options`}
                    options={item.opts ?? []}
                    selected={(option) => Array.isArray(value) && (value as string[]).includes(option)}
                    onSelect={(option) => onToggleMulti(item.key, option)}
                    disabled={readOnly}
                />
                {!readOnly && <p data-component={`${dataComponent}_helper`} className="field-helper">해당하는 상태를 선택해 주세요(여러 개 선택 가능).</p>}
            </>
        );
    }

    if (item.type === "radio" || item.type === "stool") {
        return (
            <>
                <FieldOptions
                    dataComponent={`${dataComponent}_radio-options`}
                    options={item.opts ?? []}
                    selected={(option) => value === option}
                    onSelect={(option) => onFieldChange(item.key, option)}
                    radio
                    disabled={readOnly}
                />
                {!readOnly && <p data-component={`${dataComponent}_helper`} className="field-helper">해당하는 항목 한 개를 선택해 주세요.</p>}
                {item.type === "stool" && value === "이상변" && (
                    <>
                        <label htmlFor={`${dataComponent}-stool-color`} className="lab">이상변의 색깔과 상태</label>
                        <TextInput
                            id={`${dataComponent}-stool-color`}
                            data-component={`${dataComponent}_stool-color-input`}
                            placeholder="예: 초록색, 묽은 변"
                            value={(draft[`${item.key}_color`] as string) ?? ""}
                            disabled={readOnly}
                            aria-required={!readOnly}
                            aria-invalid={!readOnly && touched.stool_color && !hasDisplayValue(draft.stool_color) ? "true" : undefined}
                            aria-describedby={`${dataComponent}-stool-color-helper`}
                            onBlur={() => touch("stool_color")}
                            onChange={(event) => onFieldChange(`${item.key}_color`, event.target.value)}
                        />
                        <p id={`${dataComponent}-stool-color-helper`} data-component={`${dataComponent}_stool-color-input_helper`} className={`field-helper${!readOnly && touched.stool_color && !hasDisplayValue(draft.stool_color) ? " err" : ""}`} role={!readOnly && touched.stool_color && !hasDisplayValue(draft.stool_color) ? "alert" : undefined}>
                            이상변을 선택했으니 변의 색깔이나 평소와 다른 상태를 적어 주세요.
                        </p>
                    </>
                )}
            </>
        );
    }

    if (item.type === "counts") {
        return (
            <div data-component={`${dataComponent}_count-options`} data-slot="segrow" className="segrow">
                {item.counts?.map((count) => {
                    const fieldKey = `${item.key}_${count.k}`;
                    const error = numericErrors[fieldKey]
                        ?? (!readOnly && touched[fieldKey] && !hasDisplayValue(draft[fieldKey]) ? `${count.label} 값을 숫자로 입력해 주세요.` : undefined);
                    const helperId = `${dataComponent}-${item.key}-${count.k}-helper`;
                    const countComponent = `${dataComponent}_count-options_${count.k}-input`;
                    const helper = count.k === "temp"
                        ? "측정한 체온을 숫자로 입력해 주세요(예: 36.5)."
                        : count.unit === "ml" ? "한 번에 먹인 양을 ml 없이 입력해 주세요(예: 60, 먹이지 않았으면 0)."
                            : "횟수만 숫자로 입력해 주세요(예: 2, 하지 않았으면 0).";
                    return (
                        <div data-component={countComponent} data-slot="segnum-field" className="segnum-field" key={count.k}>
                            <div data-component={`${countComponent}_control-row`} data-slot="segnum" className="segnum">
                                <span>{count.label}</span>
                                <input
                                    data-slot="segnum-input"
                                    type="number"
                                    aria-label={count.label}
                                    aria-invalid={error ? "true" : undefined}
                                    id={`${countComponent}-control`}
                                    data-component={`${countComponent}_control-row_control`}
                                    aria-describedby={helperId}
                                    placeholder={count.k === "temp" ? "36.5" : count.unit === "ml" ? "60" : "0"}
                                    onBlur={() => touch(fieldKey)}
                                    inputMode={count.k === "temp" ? "decimal" : "numeric"}
                                    min={count.min ?? 0}
                                    step={count.step ?? 1}
                                    value={(draft[fieldKey] as string) ?? ""}
                                    disabled={readOnly}
                                    onChange={(event) => onFieldChange(fieldKey, event.target.value)}
                                />
                                <span>{count.unit}</span>
                            </div>
                            <p id={helperId} data-component={`${countComponent}_helper`} className={`field-helper${error ? " err" : ""}`} role={error ? "alert" : undefined}>{error ?? helper}</p>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (item.type === "textarea") {
        const placeholder = item.key === "etcService" ? "예: 신생아 옷 정리" : "예: 산모 요청으로 간식 시간을 변경함";
        const fieldDataComponent = item.key === "etcService" ? "etc-service" : "notes";
        const inputId = `${dataComponent}-${fieldDataComponent}`;
        const textValue = (value as string) ?? "";
        const tooLong = !readOnly && item.maxLength !== undefined && textValue.length > item.maxLength;
        return (
            <>
                <textarea
                    id={inputId}
                    aria-label={item.label}
                    aria-describedby={`${inputId}-helper`}
                    aria-invalid={tooLong ? "true" : undefined}
                    data-component={`${dataComponent}_${fieldDataComponent}`}
                    data-slot="ta"
                    className="ta"
                    value={textValue}
                    onChange={(event) => onFieldChange(item.key, event.target.value)}
                    placeholder={placeholder}
                    maxLength={item.maxLength}
                    disabled={readOnly}
                />
                <p id={`${inputId}-helper`} data-component={`${dataComponent}_${fieldDataComponent}_helper`} className={`field-helper${tooLong ? " err" : ""}`} role={tooLong ? "alert" : undefined}>
                    {tooLong ? `${item.maxLength}자보다 길어서 내용을 줄여야 해요.` : `기록할 내용이 없으면 비워 두세요. 최대 ${item.maxLength}자까지 적을 수 있어요.`} ({textValue.length}/{item.maxLength}자)
                </p>
            </>
        );
    }

    if (item.type === "confirm") {
        return (
            <>
                <FieldOptions
                    dataComponent={`${dataComponent}_confirm-options`}
                    options={["결제 확인 완료"]}
                    selected={() => Boolean(value)}
                    onSelect={() => onFieldChange(item.key, !value)}
                    disabled={readOnly}
                />
                {!readOnly && <p data-component={`${dataComponent}_helper`} className="field-helper">실제 결제 여부를 확인한 뒤 ‘결제 확인 완료’를 눌러 주세요.</p>}
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
    const [phoneTouched, setPhoneTouched] = useState(false);
    const touchHeader = (key: ServiceRecordHeaderValidationKey) => setTouchedHeader((current) => ({ ...current, [key]: true }));
    // Only an administrator editor with an explicit patch error map owns validation scope.
    // Employee forms and callers without that map still validate the complete header.
    const usesScopedHeaderErrors = adminMode && suppliedHeaderErrors !== undefined;
    const headerErrors = usesScopedHeaderErrors ? (suppliedHeaderErrors ?? {}) : {
        ...suppliedHeaderErrors,
        ...getServiceRecordHeaderErrors(header, new Date(), { required: !adminMode }),
    };
    const visibleHeaderError = (key: ServiceRecordHeaderValidationKey) => readOnly ? undefined
        : suppliedHeaderErrors?.[key] || ((touchedHeader[key] || adminMode) ? headerErrors[key] : undefined);
    const phoneFieldError = phoneError || (phoneTouched && phone.replace(/\D/g, "").length < 10 ? "휴대폰 번호를 끝까지 입력해 주세요(예: 01012345678)." : null);
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
    const currentServiceDate = (draft._date as string | undefined)
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
    const isCurrentPageComplete = currentDayPage.items.every((index) => {
        const item = DAILY_ITEMS[index];
        if (!item || !isDailyItemComplete(item, draft)) return false;
        if (item.type === "textarea" && item.maxLength !== undefined && typeof draft[item.key] === "string") {
            return (draft[item.key] as string).length <= item.maxLength;
        }
        if (item.type !== "counts") return true;
        return (item.counts ?? []).every((count) => !numericErrors[`${item.key}_${count.k}`]);
    });
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
    const babyWeightInputId = "service-record-header-babyWeight";
    const babyWeightErrorId = `${babyWeightInputId}-error`;
    const babyWeightError = visibleHeaderError("babyWeight");

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
                        <label data-component={child("body_phone-label")} data-slot="lab" className="lab" htmlFor="service-record-phone">휴대폰 번호</label>
                        <TextInput
                            id="service-record-phone"
                            data-component={child("body_phone-input")}
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            maxLength={13}
                            placeholder="예: 01012345678"
                            aria-describedby="service-record-phone-helper"
                            aria-invalid={phoneFieldError ? "true" : undefined}
                            value={phone}
                            onBlur={() => setPhoneTouched(true)}
                            onChange={handlePhoneChange}
                        />
                        <p id="service-record-phone-helper" data-component={child("body_phone-input_helper")} className={`field-helper${phoneFieldError ? " err" : ""}`} role={phoneFieldError ? "alert" : undefined}>
                            {phoneFieldError ?? "제공인력 본인의 휴대폰 번호를 숫자로 입력해 주세요. 하이픈(-)은 자동으로 붙어요."}
                        </p>
                        <button data-component={child("body_phone-submit")} data-slot="btn" className="btn primary" disabled={busy} onClick={() => onSubmitPhone()}>{busy ? "확인 중…" : "확인하기"}</button>
                    </>
                )}

                {screen === "service" && context && (
                    <>
                        <button data-component={child("body_service-back")} data-slot="text-back" className="text-back" type="button" onClick={onBack}>이전</button>
                        <div data-component={child("body_service-title")} data-slot="step-title" className="step-title">서비스 기본정보</div>
                        <div data-component={child("body_readonly-row")} data-slot="ro" className="ro"><span>제공인력</span><b>{context.employee?.name ?? "정보 없음"}</b></div>
                        <div data-component={child("body_readonly-row-2")} data-slot="ro" className="ro"><span>제공기관</span><b>{context.org?.name ?? "인천 아이미래로"}</b></div>
                        {HEADER_FIELDS.slice(0, 4).map((field) => {
                            const inputId = `service-record-header-${field.k}`;
                            const errorId = `${inputId}-error`;
                            const fieldError = visibleHeaderError(field.k);
                            const inputComponent = child(`body_field_${HEADER_FIELD_COMPONENT_SUFFIX[field.k]}-input`);
                            return (
                                <div data-component={inputComponent} data-slot="fld" className="fld" key={field.k}>
                                    <label data-slot="lab" className="lab" htmlFor={inputId}>{field.label}</label>
                                    <TextInput
                                        id={inputId}
                                        data-component={`${inputComponent}_control`}
                                        placeholder={field.ph}
                                        inputMode={field.inputMode}
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-required={!readOnly && !adminMode}
                                        onBlur={() => touchHeader(field.k)}
                                        value={header[field.k] ?? ""}
                                        disabled={readOnly}
                                        aria-invalid={fieldError ? "true" : undefined}
                                        aria-describedby={errorId}
                                        onChange={(event) => onHeaderChange(field.k,
                                            field.k === "momBirth" || field.k === "babyBirth"
                                                ? formatBirthdayInput(event.target.value)
                                                : event.target.value,
                                        )}
                                    />
                                    <p id={errorId} data-component={`${inputComponent}_helper`} className={`field-helper${fieldError ? " err" : ""}`} role={fieldError ? "alert" : undefined}>{fieldError ?? field.helper}</p>
                                </div>
                            );
                        })}
                        <div data-component={child("body_delivery-field")} data-slot="fld" className="fld">
                            <label data-slot="lab" className="lab">분만형태</label>
                            <FieldOptions
                                dataComponent={child("body_delivery-field_options")}
                                options={["자연분만", "제왕절개"]}
                                selected={(option) => header.deliveryType === option}
                                onSelect={(value) => { touchHeader("deliveryType"); onDeliveryTypeChange(value); }}
                                radio
                                disabled={readOnly}
                            />
                            <p data-component={child("body_delivery-field_options_helper")} className={`field-helper${visibleHeaderError("deliveryType") ? " err" : ""}`} role={visibleHeaderError("deliveryType") ? "alert" : undefined}>
                                {visibleHeaderError("deliveryType") ?? "산모의 실제 분만형태 한 개를 선택해 주세요."}
                            </p>
                        </div>
                        <div data-component={child("body_field-2_baby-weight-input")} data-slot="fld" className="fld">
                            <label data-slot="lab" className="lab" htmlFor={babyWeightInputId}>{HEADER_FIELDS[4].label}</label>
                            <TextInput
                                id={babyWeightInputId}
                                data-component={child("body_field-2_baby-weight-input_control")}
                                placeholder={HEADER_FIELDS[4].ph}
                                inputMode="decimal"
                                aria-required={!readOnly && !adminMode}
                                onBlur={() => touchHeader("babyWeight")}
                                value={header.babyWeight ?? ""}
                                disabled={readOnly}
                                aria-invalid={babyWeightError ? "true" : undefined}
                                aria-describedby={babyWeightErrorId}
                                onChange={(event) => onHeaderChange(HEADER_FIELDS[4].k, event.target.value)}
                            />
                            <p id={babyWeightErrorId} data-component={child("body_field-2_baby-weight-input_helper")} className={`field-helper${babyWeightError ? " err" : ""}`} role={babyWeightError ? "alert" : undefined}>{babyWeightError ?? HEADER_FIELDS[4].helper}</p>
                        </div>
                        {!readOnly && !adminMode && !isHeaderComplete && <p data-component={child("body_header-action_helper")} className="field-helper">입력칸 아래 안내에 맞게 기본정보를 모두 작성하면 ‘다음’을 누를 수 있어요.</p>}
                        {adminMode && slots?.adminHeaderAction ? slots.adminHeaderAction({ isHeaderComplete, headerErrors }) : (
                            <button data-slot="btn" className="btn primary" disabled={readOnly || busy || !isHeaderComplete} onClick={() => { if (isHeaderComplete && !readOnly && !busy) void onSaveHeader(); }}>{busy ? "저장 중…" : adminMode ? "초안 저장" : "다음"}</button>
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
                                <label data-slot="lab" className="lab" htmlFor="service-record-date">제공일자</label>
                                {adminEditing && slots?.serviceDateEditor ? (
                                    slots.serviceDateEditor({
                                        "data-component": child("body_service-date-editor"),
                                        sessionIndex: day,
                                        serviceDate: currentServiceDate,
                                        disabled: busy,
                                        onOpen: () => onOpenServiceDateEditor?.(day),
                                    })
                                ) : (
                                    <TextInput id="service-record-date" data-component={child("body_service-date-field_date-input")} aria-describedby="service-record-date-helper" type="date" className="dateinput" value={currentServiceDate} min={day <= 1 ? (context?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day)} onChange={(event) => onServiceDateChange(event.target.value)} />
                                )}
                                <p id="service-record-date-helper" data-component={child("body_service-date-field_date-input_helper")} className="field-helper">실제로 서비스를 제공한 날짜를 달력에서 선택해 주세요.</p>
                            </div>
                        )}
                        {!readOnly && (!editing || adminMode) && hasServiceDateMismatch && (
                            <div data-component={child("body_date-mismatch-notice")} data-slot="notice" className="notice">
                                <span>서비스 제공일자({formatMonthDayKo(currentServiceDate)})가 오늘과 달라요. 한번 더 확인해 주세요.</span>
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
                                        <div data-component={child(`body_day-field_${item.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)} data-slot="fld" className="fld" key={item.key}>
                                            <label data-slot="lab" className="lab">{item.label}</label>
                                            <DailyField
                                                dataComponent={child(`body_day-field_${item.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)}
                                                item={item}
                                                draft={draft}
                                                onFieldChange={onFieldChange}
                                                onToggleMulti={onToggleMulti}
                                                readOnly={readOnly}
                                                numericErrors={numericErrors}
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
                                    disabled={!readOnly && (adminMode ? hasInvalidNumericAnswersOnCurrentPage : !isCurrentPageComplete)}
                                    onClick={onNextPage}
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
