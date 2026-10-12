"use client";

import type { ReactNode } from "react";
import {
    DAILY_ITEMS,
    DAY_PAGES,
    formatMonthDayKo,
    getServiceRecordNumericErrors,
    hasInvalidNumericAnswersOnPage,
    hintMessage,
    resolvePlannedDates,
    type ServiceRecordWizardProps,
    type ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { ServiceRecordItemLabel, StickyActionBar } from "@/components/app/ui/service-record";
import { Button } from "@/components/ui/button";

import { DailyItemField } from "./DailyItemField";
import {
    BACK_LABEL,
    NEXT_LABEL,
    SERVICE_DATE_MISMATCH_COPY,
    SERVICE_DATE_READONLY_HELPER_ID,
    SERVICE_DATE_READONLY_LABEL,
    SERVICE_DATE_READONLY_LABEL_ID,
    dailyFieldComponent,
} from "./ids";

const HEAD_SOURCE_COMPONENT = "DayPageHead";
const STEP_SOURCE_COMPONENT = "DayPageStep";

/** The admin editor always runs the shared wizard with `adminMode` (SRW:574, :890, :902, :956, :1011, :1031, :1034). */
export const ADMIN_MODE = true;

export type DayPageHeadProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "day"
    | "editing"
    | "readOnly"
    | "busy"
    | "hasServiceDateMismatch"
    | "onBack"
    | "onOpenServiceDateEditor"
> & {
    /** From `resolvePlannedDates` (SRW:572). */
    currentServiceDate: string;
    /** The step title shown under the date rows (SRW:969). */
    title: string;
    /** Rendered inside the date chip while `editing` (SRW:893-900); falls back to the month/day. */
    serviceDateDisplay?: ServiceRecordWizardSlots["serviceDateDisplay"];
    /** The administrator date editor trigger, rendered beside the chip (SRW:902-908). */
    serviceDateEditor?: ServiceRecordWizardSlots["serviceDateEditor"];
    /** Rendered under the title (the review page's banner). */
    children?: ReactNode;
};

/**
 * Back button, date chip + editor, read-only date row and step title: the top of
 * every admin day page, including the confirmation page (SRW:879-969). It renders no
 * public service-date input (SRW:590, :910) and no schedule-change controls.
 */
export function DayPageHead({
    "data-component": root,
    day,
    editing,
    readOnly = false,
    busy,
    hasServiceDateMismatch,
    onBack,
    onOpenServiceDateEditor,
    currentServiceDate,
    title,
    serviceDateDisplay,
    serviceDateEditor,
    children,
}: DayPageHeadProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    return (
        <div
            data-component={child("body_day-head")}
            data-source-component={HEAD_SOURCE_COMPONENT}
            className="flex min-w-0 flex-col gap-[calc(14px*var(--glint-ui-scale,1))]"
        >
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
            {/* SRW:890 - `date-row` is the hook the admin tests use to see the editor and the chip as siblings. */}
            <div
                data-slot="date-row"
                className="date-row flex min-w-0 items-baseline justify-between gap-[calc(8px*var(--glint-ui-scale,1))]"
            >
                <div
                    data-component={child("body_date-chip")}
                    data-slot="datechip"
                    className="inline-block min-w-0 rounded-full bg-v3-primary-light px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-bold text-v3-primary"
                >
                    {day}회차{editing ? " · " : ""}
                    {editing
                        ? serviceDateDisplay?.({
                            "data-component": child("body_date-chip_date-display"),
                            sessionIndex: day,
                            serviceDate: currentServiceDate,
                        }) ?? formatMonthDayKo(currentServiceDate)
                        : null}
                </div>
                {serviceDateEditor ? serviceDateEditor({
                    "data-component": child("body_date-edit"),
                    sessionIndex: day,
                    serviceDate: currentServiceDate,
                    disabled: readOnly || busy,
                    onOpen: () => onOpenServiceDateEditor?.(day),
                }) : null}
            </div>
            {/* SRW:955-968 - in admin (editing or not) the date's caution lives in a compact read-only row; never in read-only mode. */}
            {!readOnly && hasServiceDateMismatch && (
                <div data-component={child("body_service-date-readonly")}>
                    <ServiceRecordItemLabel
                        data-component={child("body_service-date-readonly_date_label-row")}
                        labelId={SERVICE_DATE_READONLY_LABEL_ID}
                        label={SERVICE_DATE_READONLY_LABEL}
                        messageId={SERVICE_DATE_READONLY_HELPER_ID}
                        message={hintMessage(SERVICE_DATE_MISMATCH_COPY)}
                    />
                    <div
                        data-component={child("body_service-date-readonly_value")}
                        data-slot="ro"
                        className="flex h-[calc(38px*var(--glint-ui-scale,1))] items-center rounded-[13px] border-[1.35px] border-v3-border! bg-v3-dim-white px-[calc(14px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] text-v3-dark"
                    >
                        <b>{currentServiceDate}</b>
                    </div>
                </div>
            )}
            <div data-component={child("body_day-title")} className="text-[calc(17px*var(--glint-ui-scale,1))] font-extrabold text-v3-dark">{title}</div>
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
    | "readOnly"
    | "busy"
    | "hasServiceDateMismatch"
    | "defaultDate"
    | "onBack"
    | "onFieldChange"
    | "onToggleMulti"
    | "onNextPage"
    | "onOpenServiceDateEditor"
> & {
    serviceDateDisplay?: ServiceRecordWizardSlots["serviceDateDisplay"];
    serviceDateEditor?: ServiceRecordWizardSlots["serviceDateEditor"];
};

/**
 * A non-confirmation day page of the admin editor (SRW:879-1037 with `adminMode`).
 * It renders its body and its sticky action bar as siblings, so the parent must be
 * the screen's `min-h-dvh` column, which also owns the header.
 *
 * Admin has no validation flow: 다음 calls `onNextPage` unvalidated (SRW:663-666) and
 * is only disabled by an invalid number on this page (SRW:1031).
 */
export function DayPageStep({
    "data-component": root,
    context,
    day,
    pageIdx,
    draft,
    editing,
    readOnly = false,
    busy,
    hasServiceDateMismatch,
    defaultDate,
    onBack,
    onFieldChange,
    onToggleMulti,
    onNextPage,
    onOpenServiceDateEditor,
    serviceDateDisplay,
    serviceDateEditor,
}: DayPageStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: ADMIN_MODE, draft, defaultDate,
    });
    const numericErrors = getServiceRecordNumericErrors(draft);
    const hasInvalidNumericAnswersOnCurrentPage = hasInvalidNumericAnswersOnPage(currentDayPage.items, numericErrors);

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={STEP_SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
            >
                <DayPageHead
                    data-component={root}
                    day={day}
                    editing={editing}
                    readOnly={readOnly}
                    busy={busy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    onBack={onBack}
                    onOpenServiceDateEditor={onOpenServiceDateEditor}
                    currentServiceDate={currentServiceDate}
                    title={currentDayPage.title}
                    serviceDateDisplay={serviceDateDisplay}
                    serviceDateEditor={serviceDateEditor}
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
                            readOnly={readOnly}
                        />
                    );
                })}
            </div>
            <StickyActionBar data-component={child("body_nav")}>
                <Button
                    type="button"
                    variant="positive"
                    disabled={!readOnly && hasInvalidNumericAnswersOnCurrentPage} // SRW:1031 with adminMode
                    onClick={() => onNextPage()} // SRW:663-666 (called without the click event, as handleNextPage does)
                >
                    {NEXT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
