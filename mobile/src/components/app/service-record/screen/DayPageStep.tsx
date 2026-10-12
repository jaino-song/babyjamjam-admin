"use client";

import type { ReactNode } from "react";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import {
    DAILY_ITEMS,
    DAY_PAGES,
    focusFirstProblem,
    formatMonthDayKo,
    getFirstDayPageProblem,
    getServiceDateMessage,
    getServiceDateMin,
    getServiceRecordNumericErrors,
    hintMessage,
    resolvePlannedDates,
    type ServiceRecordWizardProps,
} from "@babyjamjam/service-record-ui";

import { Input } from "@/components/app/v3/Input";
import { ServiceRecordItemLabel } from "@/components/app/v3/ServiceRecordItemLabel";
import { StickyActionBar } from "@/components/app/v3/StickyActionBar";
import { Button } from "@/components/ui/button";

import { DailyItemField } from "./DailyItemField";
import {
    BACK_LABEL,
    NEXT_LABEL,
    SAVE_SECTION_LABEL,
    SCHEDULE_CHANGE_LABEL,
    SCHEDULE_CHANGE_PENDING_LABEL,
    SCHEDULE_HELP_COPY,
    SERVICE_DATE_HELPER_ID,
    SERVICE_DATE_INPUT_ID,
    SERVICE_DATE_LABEL,
    SERVICE_DATE_LABEL_ID,
    SERVICE_DATE_MISMATCH_COPY,
    SERVICE_DATE_PLACEHOLDER,
    SERVICE_DATE_READONLY_HELPER_ID,
    SERVICE_DATE_READONLY_LABEL,
    SERVICE_DATE_READONLY_LABEL_ID,
    dailyFieldComponent,
    getDailyItemProblemId,
} from "./ids";
import type { ServiceDateFieldState } from "./serviceDateFieldState";

const HEAD_SOURCE_COMPONENT = "DayPageHead";
const STEP_SOURCE_COMPONENT = "DayPageStep";

type DayPageHeadProps = Pick<ServiceRecordWizardProps, "data-component" | "day" | "pageIdx" | "editing" | "hasServiceDateMismatch" | "onBack"> & {
    currentServiceDate: string;
    /** The service-date field (page 0 only); it sits between the date chip and the read-only date row. */
    dateField?: ReactNode;
    /** The step title shown under the date rows. */
    title: string;
    children?: ReactNode;
};

/**
 * Back button, date chip, service-date field slot, read-only date row and step
 * title: the top of every day page, including the review page (SRW:879-969).
 */
export function DayPageHead({
    "data-component": root,
    day,
    pageIdx,
    editing,
    hasServiceDateMismatch,
    onBack,
    currentServiceDate,
    dateField,
    title,
    children,
}: DayPageHeadProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const serviceDateFieldVisible = !editing && pageIdx === 0;
    return (
        <div data-component={child("body_day-head")} data-source-component={HEAD_SOURCE_COMPONENT} className="flex flex-col gap-3.5">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                data-component={child("body_day-back")}
                className="-ml-3 self-start text-v3-text-muted"
                onClick={onBack}
            >
                {BACK_LABEL}
            </Button>
            <div
                data-component={child("body_date-chip")}
                className="self-start rounded-full bg-v3-primary-light px-3 py-1 text-sm font-bold text-v3-primary"
            >
                {day}회차{editing ? " · " : ""}
                {editing ? formatMonthDayKo(currentServiceDate) : null}
            </div>
            {dateField}
            {/* Where no date field is on the page (later pages) the date's caution still lives in a field slot: a compact read-only row. */}
            {(!editing) && hasServiceDateMismatch && !serviceDateFieldVisible && (
                <div data-component={child("body_service-date-readonly")}>
                    <ServiceRecordItemLabel
                        data-component={child("body_service-date-readonly_date")}
                        labelId={SERVICE_DATE_READONLY_LABEL_ID}
                        label={SERVICE_DATE_READONLY_LABEL}
                        messageId={SERVICE_DATE_READONLY_HELPER_ID}
                        message={hintMessage(SERVICE_DATE_MISMATCH_COPY)}
                    />
                    <div
                        data-component={child("body_service-date-readonly_value")}
                        data-slot="ro"
                        className="flex h-11 items-center rounded-[12px] border-[1.5px] border-v3-border! bg-v3-dim-white px-3.5 text-base text-v3-dark"
                    >
                        <b>{currentServiceDate}</b>
                    </div>
                </div>
            )}
            <div data-component={child("body_day-title")} className="text-lg font-bold text-v3-dark">{title}</div>
            {children}
        </div>
    );
}

export type DayPageStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "context"
    | "day"
    | "pageIdx"
    | "draft"
    | "editing"
    | "isRecordFinalized"
    | "scheduleChangeBusy"
    | "hasServiceDateMismatch"
    | "defaultDate"
    | "onBack"
    | "onServiceDateChange"
    | "onOpenScheduleChangePreview"
    | "onFieldChange"
    | "onToggleMulti"
    | "onNextPage"
> & {
    /** The service-date field's state, owned by the screen root so it outlives this step (SRW:529-536). */
    dateState: ServiceDateFieldState;
};

/**
 * A non-confirmation day page of the public flow (SRW:879-1037 with `readOnly` and
 * `adminMode` false). It renders its own body and its sticky action bar as
 * siblings, so the parent must be the screen's min-h-dvh column. The service-date
 * field's state (edit text, focus, touched, had-value, submitted) is the root's
 * `dateState`, so it survives a switch to the review page and back.
 */
export function DayPageStep({
    "data-component": root,
    context,
    day,
    pageIdx,
    draft,
    editing,
    isRecordFinalized,
    scheduleChangeBusy,
    hasServiceDateMismatch,
    defaultDate,
    onBack,
    onServiceDateChange,
    onOpenScheduleChangePreview,
    onFieldChange,
    onToggleMulti,
    onNextPage,
    dateState,
}: DayPageStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const {
        focused: serviceDateFocused,
        setFocused: setServiceDateFocused,
        touched: serviceDateTouched,
        setTouched: setServiceDateTouched,
        edit: serviceDateEdit,
        setEdit: setServiceDateEdit,
        submittedPageKey,
        setSubmittedPageKey,
        hadValue: hadServiceDateValue,
    } = dateState;

    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { providerDateLocked, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: false, draft, defaultDate,
    });
    const numericErrors = getServiceRecordNumericErrors(draft);
    const currentPageKey = `${day}:${pageIdx}`;
    const daySubmitted = submittedPageKey === currentPageKey;
    // The service date is typed as YYYY-MM-DD; state stays ISO and only a complete valid date is reported.
    const serviceDateMin = getServiceDateMin({ day, context, defaultDate });
    const serviceDateText = serviceDateEdit && serviceDateEdit.base === currentServiceDate && serviceDateEdit.day === day
        ? serviceDateEdit.text : null;
    const serviceDateValue = serviceDateText ?? currentServiceDate;
    const serviceDateFieldVisible = !editing && pageIdx === 0;
    const {
        reportable: serviceDateIsReportable,
        blocked: serviceDateBlocked,
        message: serviceDateMessage,
        slot: serviceDateSlot,
    } = getServiceDateMessage({
        text: serviceDateText,
        hadValue: hadServiceDateValue,
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
        return getDailyItemProblemId(problem.item, dailyFieldComponent(root, problem.item), problem.problem);
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
    const handleNextPage = () => {
        const problemId = firstDayProblemId();
        if (problemId) {
            setSubmittedPageKey(currentPageKey);
            focusFirstProblem(problemId);
            return;
        }
        onNextPage();
    };

    const scheduleChangeDisabled = isRecordFinalized || scheduleChangeBusy || Boolean(context?.pendingScheduleChange);

    const dateField = serviceDateFieldVisible ? (
        <div data-component={child("body_service-date-field")}>
            <ServiceRecordItemLabel
                data-component={child("body_service-date-field_date-input_label-row")}
                labelId={SERVICE_DATE_LABEL_ID}
                label={SERVICE_DATE_LABEL}
                htmlFor={SERVICE_DATE_INPUT_ID}
                messageId={SERVICE_DATE_HELPER_ID}
                message={serviceDateSlot}
            />
            <Input
                id={SERVICE_DATE_INPUT_ID}
                data-component={child("body_service-date-field_date-input")}
                className="text-base focus-visible:border-v3-primary! aria-[invalid=true]:border-v3-burgundy!"
                aria-describedby={SERVICE_DATE_HELPER_ID}
                aria-invalid={serviceDateMessage?.tone === "error" ? "true" : undefined}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                placeholder={SERVICE_DATE_PLACEHOLDER}
                disabled={providerDateLocked}
                value={serviceDateValue}
                onFocus={() => setServiceDateFocused(true)}
                onBlur={handleServiceDateBlur}
                onChange={(event) => handleServiceDateInput(event.target.value)}
            />
            {providerDateLocked ? (
                <>
                    <p data-component={child("body_service-date-field_schedule-help")} className="mt-2 text-xs text-v3-text-muted">
                        {SCHEDULE_HELP_COPY}
                    </p>
                    <Button
                        type="button"
                        variant="v3-outline"
                        size="md"
                        data-component={child("body_service-date-field_schedule-change")}
                        className="mt-2 w-full"
                        disabled={scheduleChangeDisabled}
                        onClick={() => onOpenScheduleChangePreview()}
                    >
                        {context?.pendingScheduleChange ? SCHEDULE_CHANGE_PENDING_LABEL : SCHEDULE_CHANGE_LABEL}
                    </Button>
                </>
            ) : null}
        </div>
    ) : null;

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={STEP_SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-6 pt-4"
            >
                <DayPageHead
                    data-component={root}
                    day={day}
                    pageIdx={pageIdx}
                    editing={editing}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    onBack={onBack}
                    currentServiceDate={currentServiceDate}
                    dateField={dateField}
                    title={currentDayPage.title}
                />
                {currentDayPage.items.map((index) => {
                    const item = DAILY_ITEMS[index];
                    if (!item) return null;
                    return (
                        <DailyItemField
                            key={item.key}
                            data-component={dailyFieldComponent(root, item)}
                            item={item}
                            draft={draft}
                            onFieldChange={onFieldChange}
                            onToggleMulti={onToggleMulti}
                            numericErrors={numericErrors}
                            submitted={daySubmitted}
                        />
                    );
                })}
            </div>
            <StickyActionBar data-component={child("body_nav")}>
                <Button type="button" variant="v3" size="md" onClick={handleNextPage}>
                    {editing ? SAVE_SECTION_LABEL : NEXT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
