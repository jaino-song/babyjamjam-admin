import type { ChangeEvent, InputHTMLAttributes, ReactNode } from "react";

import {
    DAILY_ITEMS,
    DAY_PAGES,
    HEADER_FIELDS,
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
    formatMonthDayKo,
    formatReviewFieldValue,
    formatShortDate,
    hasDisplayValue,
    isDailyItemComplete,
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
}: {
    dataComponent: string;
    item: (typeof DAILY_ITEMS)[number];
    draft: Record<string, unknown>;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    readOnly?: boolean;
}) {
    const value = draft[item.key];

    if (item.type === "multi") {
        return (
            <FieldOptions
                dataComponent={`${dataComponent}_options`}
                options={item.opts ?? []}
                selected={(option) => Array.isArray(value) && (value as string[]).includes(option)}
                onSelect={(option) => onToggleMulti(item.key, option)}
                disabled={readOnly}
            />
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
                {item.type === "stool" && value === "이상변" && (
                    <input
                        data-slot="in"
                        className="in stool-color"
                        style={{ marginTop: 8 }}
                        placeholder="색깔 등 (이상변 시)"
                        value={(draft[`${item.key}_color`] as string) ?? ""}
                        disabled={readOnly}
                        onChange={(event) => onFieldChange(`${item.key}_color`, event.target.value)}
                    />
                )}
            </>
        );
    }

    if (item.type === "counts") {
        return (
            <div data-component={`${dataComponent}_count-options`} data-slot="segrow" className="segrow">
                {item.counts?.map((count) => (
                    <div data-component={`${dataComponent}_count-options_row`} data-slot="segnum" className="segnum" key={count.k}>
                        <span>{count.label}</span>
                        <input
                            data-slot="segnum-input"
                            type="number"
                            aria-label={count.label}
                            inputMode={count.k === "temp" ? "decimal" : "numeric"}
                            min="0"
                            step={count.k === "temp" ? "0.1" : "1"}
                            value={(draft[`${item.key}_${count.k}`] as string) ?? ""}
                            disabled={readOnly}
                            onChange={(event) => onFieldChange(`${item.key}_${count.k}`, event.target.value)}
                        />
                        <span>{count.unit}</span>
                    </div>
                ))}
            </div>
        );
    }

    if (item.type === "textarea") {
        const placeholder = item.key === "etcService"
            ? "추가사항에 대한 기록 필요 시 기재"
            : "서비스 제공 관련 특이사항 기록 필요 시 기재";
        const fieldDataComponent = item.key === "etcService" ? "etc-service" : "notes";
        return (
            <textarea
                data-component={`${dataComponent}_${fieldDataComponent}`}
                data-slot="ta"
                className="ta"
                value={(value as string) ?? ""}
                onChange={(event) => onFieldChange(item.key, event.target.value)}
                placeholder={placeholder}
                maxLength={item.maxLength}
                disabled={readOnly}
            />
        );
    }

    if (item.type === "confirm") {
        return (
            <FieldOptions
                dataComponent={`${dataComponent}_confirm-options`}
                options={["결제 확인 완료"]}
                selected={() => Boolean(value)}
                onSelect={() => onFieldChange(item.key, !value)}
                disabled={readOnly}
            />
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
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const adminEditing = adminMode && !readOnly;
    const currentSession = context?.sessions.find((session) => session.sessionIndex === day);
    const currentServiceDate = (draft._date as string | undefined) || defaultDate(day);
    const isMomConfirmationPage = Boolean(currentDayPage.confirmation);
    const signatureValue = currentSession?.clientSignature ?? clientSignature;
    const isSignatureLocked = Boolean(currentSession?.clientSignature);
    const isHeaderComplete = HEADER_FIELDS.every((field) => hasDisplayValue(header[field.k]))
        && hasDisplayValue(header.deliveryType);
    const isCurrentPageComplete = currentDayPage.items.every((index) => {
        const item = DAILY_ITEMS[index];
        return item ? isDailyItemComplete(item, draft) : false;
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
                            placeholder="예) 01012345678"
                            value={phone}
                            onChange={handlePhoneChange}
                        />
                        {phoneError && <p data-slot="err" className="err">{phoneError}</p>}
                        <button data-component={child("body_phone-submit")} data-slot="btn" className="btn primary" disabled={busy} onClick={() => onSubmitPhone()}>{busy ? "확인 중…" : "확인하기"}</button>
                    </>
                )}

                {screen === "service" && context && (
                    <>
                        <button data-component={child("body_service-back")} data-slot="text-back" className="text-back" type="button" onClick={onBack}>이전</button>
                        <div data-component={child("body_service-title")} data-slot="step-title" className="step-title">서비스 기본정보</div>
                        <div data-component={child("body_readonly-row")} data-slot="ro" className="ro"><span>제공인력</span><b>{context.employee?.name ?? "정보 없음"}</b></div>
                        <div data-component={child("body_readonly-row-2")} data-slot="ro" className="ro"><span>제공기관</span><b>{context.org?.name ?? "인천 아이미래로"}</b></div>
                        {HEADER_FIELDS.slice(0, 4).map((field) => (
                            <div data-component={child("body_field")} data-slot="fld" className="fld" key={field.k}>
                                <label data-slot="lab" className="lab">{field.label}</label>
                                <TextInput placeholder={field.ph} value={header[field.k] ?? ""} disabled={readOnly} onChange={(event) => onHeaderChange(field.k, event.target.value)} />
                            </div>
                        ))}
                        <div data-component={child("body_delivery-field")} data-slot="fld" className="fld">
                            <label data-slot="lab" className="lab">분만형태</label>
                            <FieldOptions
                                dataComponent={child("body_delivery-field_options")}
                                options={["자연분만", "제왕절개"]}
                                selected={(option) => header.deliveryType === option}
                                onSelect={onDeliveryTypeChange}
                                radio
                                disabled={readOnly}
                            />
                        </div>
                        <div data-component={child("body_field-2")} data-slot="fld" className="fld">
                            <label data-slot="lab" className="lab">{HEADER_FIELDS[4].label}</label>
                            <TextInput placeholder={HEADER_FIELDS[4].ph} value={header.babyWeight ?? ""} disabled={readOnly} onChange={(event) => onHeaderChange(HEADER_FIELDS[4].k, event.target.value)} />
                        </div>
                        <button data-slot="btn" className="btn primary" disabled={readOnly || busy || !isHeaderComplete} onClick={() => onSaveHeader()}>{busy ? "저장 중…" : adminMode ? "초안 저장" : "다음"}</button>
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
                                                readOnly
                                                    ? (session?.serviceDate.slice(0, 10) || defaultDate(sessionIndex))
                                                : (done ? (session?.serviceDate.slice(0, 10) ?? "") : defaultDate(sessionIndex)),
                                                "body_day-grid_day_date-display",
                                                formatShortDate(
                                                    readOnly
                                                        ? (session?.serviceDate.slice(0, 10) || defaultDate(sessionIndex))
                                                        : (done ? (session?.serviceDate.slice(0, 10) ?? "") : defaultDate(sessionIndex)),
                                                ),
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
                        {!readOnly && (!editing || adminMode) && pageIdx === 0 && (
                            <div data-component={child("body_service-date-field")} data-slot="fld" className="fld">
                                <label data-slot="lab" className="lab">제공일자</label>
                                {adminEditing && slots?.serviceDateEditor ? (
                                    slots.serviceDateEditor({
                                        "data-component": child("body_service-date-editor"),
                                        sessionIndex: day,
                                        serviceDate: currentServiceDate,
                                        disabled: busy,
                                        onOpen: () => onOpenServiceDateEditor?.(day),
                                    })
                                ) : (
                                    <TextInput type="date" className="dateinput" value={currentServiceDate} min={day <= 1 ? (context?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day)} onChange={(event) => onServiceDateChange(event.target.value)} />
                                )}
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
                                {editing && (
                                    <div data-component={child("body_resign-notice")} data-slot="notice" className="notice">
                                        <span>이미 제출된 회차입니다.</span>
                                    </div>
                                )}
                                <div data-component={child("body_handover-banner")} data-slot="handover" className="handover">
                                    <b>최종 기록을 확인해 주세요.</b>
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
                                        <div data-component={child("body_day-field")} data-slot="fld" className="fld" key={item.key}>
                                            <label data-slot="lab" className="lab">{item.label}</label>
                                            <DailyField
                                                dataComponent={child("body_day-field")}
                                                item={item}
                                                draft={draft}
                                                onFieldChange={onFieldChange}
                                                onToggleMulti={onToggleMulti}
                                                readOnly={readOnly}
                                            />
                                        </div>
                                    );
                                })}
                            </>
                        )}
                        {isMomConfirmationPage ? (
                            <div data-component={child("body_confirmation-action")} data-slot="nav" className="nav confirmation-nav">
                                <button data-slot="btn" className="btn submit" disabled={readOnly || busy || (!adminMode && !signatureValue)} onClick={onOpenSubmitModal}>{readOnly ? "조회 전용" : adminMode ? (busy ? "저장 중…" : "초안 저장") : "확인"}</button>
                            </div>
                        ) : (
                            <div data-component={child("body_nav")} data-slot="nav" className="nav">
                                <button
                                    data-slot="btn"
                                    className="btn primary"
                                    disabled={!readOnly && !adminMode && !isCurrentPageComplete}
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
