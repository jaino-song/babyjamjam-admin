"use client";

import { formatShortDate, resolvePlannedDates, type ServiceRecordWizardProps } from "@babyjamjam/service-record-ui";

import { DayCard, DayCardGrid, type DayCardState } from "@/components/app/v3/DayCardGrid";
import { StickyActionBar } from "@/components/app/v3/StickyActionBar";
import { Button } from "@/components/ui/button";

import {
    DAY_STATUS_DONE,
    DAY_STATUS_OPEN,
    DAY_STATUS_WAITING,
    NEXT_SESSION_LABEL,
    OVERVIEW_HELP_COPY,
    OVERVIEW_TITLE,
    SCHEDULE_CHANGE_LABEL,
    SCHEDULE_CHANGE_PENDING_LABEL,
    START_RECORD_LABEL,
} from "./ids";


const SOURCE_COMPONENT = "OverviewStep";
/** Reopens the how-to guide from the overview's title row. */
const OPEN_GUIDE_LABEL = "사용방법";

export type OverviewStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "day"
    | "draft"
    | "defaultDate"
    | "lockedDays"
    | "nextOpenDay"
    | "isRecordFinalized"
    | "scheduleChangeBusy"
    | "onOpenDay"
    | "onOpenScheduleChangePreview"
> & {
    /** The step only renders with a loaded context (SRW:813). */
    context: NonNullable<ServiceRecordWizardProps["context"]>;
    /** Reopens the how-to guide; the 사용방법 button is hidden without it. */
    onOpenGuide?: () => void;
};

/**
 * The day overview (SRW:813-877 with `readOnly` and `adminMode` false). There is no
 * back button here, as in the shared wizard.
 */
export function OverviewStep({
    "data-component": root,
    context,
    day,
    draft,
    defaultDate,
    lockedDays,
    nextOpenDay,
    isRecordFinalized,
    scheduleChangeBusy,
    onOpenDay,
    onOpenScheduleChangePreview,
    onOpenGuide,
}: OverviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const { displayDateForSession } = resolvePlannedDates({ context, day, adminMode: false, draft, defaultDate });
    const openDay = nextOpenDay();
    const scheduleChangeLabel = context.pendingScheduleChange ? SCHEDULE_CHANGE_PENDING_LABEL : SCHEDULE_CHANGE_LABEL;

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-6 pt-4"
            >
                <div className="flex items-center justify-between gap-2">
                    <div data-component={child("body_overview-title")} className="text-lg font-bold text-v3-dark">
                        {OVERVIEW_TITLE}
                    </div>
                    {onOpenGuide ? (
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            data-component={child("body_overview-guide")}
                            className="h-auto px-1 py-1 text-[13px] font-semibold text-v3-primary no-underline"
                            onClick={onOpenGuide}
                        >
                            {OPEN_GUIDE_LABEL}
                        </Button>
                    ) : null}
                </div>
                <p data-component={child("body_overview-help")} className="text-sm text-v3-text-muted">
                    {OVERVIEW_HELP_COPY}
                </p>
                <DayCardGrid data-component={child("body_day-grid")}>
                    {Array.from({ length: context.totalSessions }, (_, index) => index + 1).map((sessionIndex) => {
                        const session = context.sessions.find((row) => row.sessionIndex === sessionIndex);
                        const done = lockedDays.has(sessionIndex);
                        const open = sessionIndex === openDay;
                        const serviceDate = displayDateForSession(sessionIndex, session);
                        // SRW:826 / :833 / :846 for the public flow.
                        const state: DayCardState = done ? "done" : open ? "current" : "locked";
                        const disabled = (!done && !open) || isRecordFinalized;
                        return (
                            <DayCard
                                key={sessionIndex}
                                data-component={child("body_day-grid_day")}
                                state={state}
                                disabled={disabled}
                                dateLabel={formatShortDate(serviceDate)}
                                title={<span data-component={child("body_day-grid_day_number")}>{sessionIndex}</span>}
                                statusLabel={done ? DAY_STATUS_DONE : open ? DAY_STATUS_OPEN : DAY_STATUS_WAITING}
                                onClick={() => onOpenDay(sessionIndex, done)}
                            />
                        );
                    })}
                </DayCardGrid>
            </div>
            {lockedDays.size < context.totalSessions && (
                <StickyActionBar data-component={child("body_overview-actions")}>
                    <Button
                        type="button"
                        variant="v3"
                        size="md"
                        data-component={child("body_overview-start")}
                        className="h-auto min-h-[46px] whitespace-normal break-keep py-2 leading-tight"
                        disabled={isRecordFinalized}
                        onClick={() => onOpenDay(nextOpenDay())}
                    >
                        {lockedDays.size ? NEXT_SESSION_LABEL : START_RECORD_LABEL}
                    </Button>
                    <Button
                        type="button"
                        variant="v3-outline"
                        size="md"
                        data-component={child("body_overview-schedule-change")}
                        className="h-auto min-h-[46px] whitespace-normal break-keep py-2 leading-tight"
                        disabled={isRecordFinalized || scheduleChangeBusy || Boolean(context.pendingScheduleChange)}
                        onClick={() => onOpenScheduleChangePreview()}
                    >
                        {scheduleChangeLabel}
                    </Button>
                </StickyActionBar>
            )}
        </>
    );
}
