"use client";

import type { ReactNode } from "react";
import {
    DAILY_ITEMS,
    DAY_PAGES,
    focusFirstProblem,
    getFirstDayPageProblem,
    getServiceDateMessage,
    getServiceRecordNumericErrors,
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
    SERVICE_DATE_HELPER_ID,
    SERVICE_DATE_INPUT_ID,
    SERVICE_DATE_LABEL,
    SERVICE_DATE_LABEL_ID,
    SERVICE_DATE_PLACEHOLDER,
    dailyFieldComponent,
    getDailyItemProblemId,
} from "./ids";
import type { ServiceDateFieldState } from "./serviceDateFieldState";

const HEAD_SOURCE_COMPONENT = "DayPageHead";
const STEP_SOURCE_COMPONENT = "DayPageStep";

type DayPageHeadProps = Pick<ServiceRecordWizardProps, "data-component" | "day" | "pageIdx" | "editing" | "onBack"> & {
    currentServiceDate: string;
    /** The service-date sheet trigger (page 0 only). */
    dateField?: ReactNode;
    /** The step title shown under the date rows. */
    title: string;
    children?: ReactNode;
    titleAccessory?: ReactNode;
};

/**
 * Back button, date chip, service-date field slot and step
 * title: the top of every day page, including the review page (SRW:879-969).
 */
export function DayPageHead({
    "data-component": root,
    day,
    editing,
    onBack,
    currentServiceDate,
    dateField,
    title,
    children,
    titleAccessory,
}: DayPageHeadProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    return (
        <div data-component={child("body_day-head")} data-source-component={HEAD_SOURCE_COMPONENT} className="flex flex-col gap-3.5">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                data-component={child("body_day-back")}
                className="text-sm -ml-3 self-start text-v3-text-muted"
                onClick={onBack}
            >
                {BACK_LABEL}
            </Button>
            {!editing && <div
                data-component={child("body_date-chip")}
                className="self-start rounded-full bg-v3-primary-light px-3 py-1 text-base font-bold text-v3-primary"
            >
                {day}회차{currentServiceDate ? ` · ${currentServiceDate.replaceAll("-", ".")}` : ""}
            </div>}
            {dateField}
            <div className="flex items-center justify-between gap-2"><div data-component={child("body_day-title")} className="text-xl font-bold text-v3-dark">{title}</div>{titleAccessory}</div>
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
    | "defaultDate"
    | "onBack"
    | "onFieldChange"
    | "onToggleMulti"
    | "onNextPage"
> & {
    /** The service-date field's state, owned by the screen root so it outlives this step (SRW:529-536). */
    dateState: ServiceDateFieldState;
    onOpenDateSheet?: () => void;
    serviceDateError?: string | null;
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
    defaultDate,
    onBack,
    onFieldChange,
    onToggleMulti,
    onNextPage,
    dateState,
    onOpenDateSheet,
    serviceDateError,
}: DayPageStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const { submittedPageKey, setSubmittedPageKey } = dateState;

    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: false, draft, defaultDate,
    });
    const numericErrors = getServiceRecordNumericErrors(draft);
    const currentPageKey = `${day}:${pageIdx}`;
    const daySubmitted = submittedPageKey === currentPageKey;
    const serviceDateFieldVisible = !editing && pageIdx === 0;
    const serviceDateBlocked = !currentServiceDate || Boolean(serviceDateError);
    const serviceDateMessage = serviceDateError
        ? { tone: "error" as const, text: serviceDateError }
        : getServiceDateMessage({ label: SERVICE_DATE_LABEL, text: currentServiceDate, hadValue: false, touched: false, focused: false, submitted: daySubmitted, min: undefined, mismatch: false, fieldVisible: serviceDateFieldVisible }).message;

    const firstDayProblemId = (): string | null => {
        const problem = getFirstDayPageProblem(currentDayPage.items, draft, numericErrors, {
            serviceDateBlocked,
            serviceDateFieldVisible,
        });
        if (!problem) return null;
        if (problem.kind === "serviceDate") return SERVICE_DATE_INPUT_ID;
        return getDailyItemProblemId(problem.item, dailyFieldComponent(root, problem.item), problem.problem);
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

    const dateField = serviceDateFieldVisible ? (
        <div data-component={child("body_service-date-field")}>
            <ServiceRecordItemLabel
                data-component={child("body_service-date-field_date-input_label-row")}
                labelId={SERVICE_DATE_LABEL_ID}
                label={SERVICE_DATE_LABEL}
                htmlFor={SERVICE_DATE_INPUT_ID}
                messageId={SERVICE_DATE_HELPER_ID}
                message={serviceDateMessage}
            />
            <Input
                id={SERVICE_DATE_INPUT_ID}
                data-component={child("body_service-date-field_date-input")}
                className="text-lg focus-visible:border-v3-primary! aria-[invalid=true]:border-v3-burgundy!"
                aria-describedby={SERVICE_DATE_HELPER_ID}
                aria-invalid={serviceDateMessage?.tone === "error" ? "true" : undefined}
                type="text"
                readOnly
                aria-haspopup="dialog"
                placeholder={SERVICE_DATE_PLACEHOLDER}
                disabled={isRecordFinalized}
                value={currentServiceDate}
                onClick={onOpenDateSheet}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenDateSheet?.();
                    }
                }}
            />
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
                <Button className="text-base" type="button" variant="v3" size="md" onClick={handleNextPage}>
                    {editing ? SAVE_SECTION_LABEL : NEXT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
