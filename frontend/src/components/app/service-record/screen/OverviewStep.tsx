"use client";

import {
    formatShortDate,
    resolvePlannedDates,
    type ServiceRecordWizardProps,
    type ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { DayCard, DayCardGrid, StickyActionBar, type DayCardState } from "@/components/app/ui/service-record";

import { ADMIN_MODE } from "./DayPageStep";
import {
    DAY_STATUS_CHANGED,
    DAY_STATUS_DONE,
    DAY_STATUS_EDITABLE,
    DAY_STATUS_READONLY,
    OVERVIEW_HELP_COPY,
    OVERVIEW_HELP_READONLY_COPY,
    OVERVIEW_TITLE,
} from "./ids";

const SOURCE_COMPONENT = "OverviewStep";

export type OverviewStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "day"
    | "draft"
    | "readOnly"
    | "changedSessionIndexes"
    | "defaultDate"
    | "lockedDays"
    | "onOpenDay"
> & {
    /** The step only renders with a loaded context (SRW:813). */
    context: NonNullable<ServiceRecordWizardProps["context"]>;
    serviceDateDisplay?: ServiceRecordWizardSlots["serviceDateDisplay"];
    /** Rendered under the day grid (SRW:852). */
    overviewSupplemental?: ServiceRecordWizardSlots["overviewSupplemental"];
    /** Basic-information control: the sticky bar's leading end (SRW:858, the slot of the public schedule button). */
    adminConfirmAction?: ServiceRecordWizardSlots["adminConfirmAction"];
    /** 수정 취소 / 수정 확정: the sticky bar's actions (SRW:853). */
    adminCommitActions?: ServiceRecordWizardSlots["adminCommitActions"];
};

/**
 * The day overview of the admin editor (SRW:813-877 with `adminMode`). There is no back
 * button, as in the shared wizard, and no public start / schedule-change buttons
 * (SRW:863). It renders its body and sticky action bar as siblings, so the parent must be
 * the screen's `min-h-dvh` column.
 */
export function OverviewStep({
    "data-component": root,
    context,
    day,
    draft,
    readOnly = false,
    changedSessionIndexes,
    defaultDate,
    lockedDays,
    onOpenDay,
    serviceDateDisplay,
    overviewSupplemental,
    adminConfirmAction,
    adminCommitActions,
}: OverviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const adminEditing = ADMIN_MODE && !readOnly; // SRW:575
    const { displayDateForSession } = resolvePlannedDates({ context, day, adminMode: ADMIN_MODE, draft, defaultDate });

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
            >
                <div
                    data-component={child("body_overview-title")}
                    className="text-[calc(17px*var(--glint-ui-scale,1))] font-extrabold text-v3-dark"
                >
                    {OVERVIEW_TITLE}
                </div>
                <p
                    data-component={child("body_overview-help")}
                    className="text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted"
                >
                    {readOnly ? OVERVIEW_HELP_READONLY_COPY : OVERVIEW_HELP_COPY}
                </p>
                <DayCardGrid data-component={child("body_day-grid")}>
                    {Array.from({ length: context.totalSessions }, (_, index) => index + 1).map((sessionIndex) => {
                        const session = context.sessions.find((row) => row.sessionIndex === sessionIndex);
                        const done = lockedDays.has(sessionIndex);
                        const changed = Boolean(changedSessionIndexes?.has(sessionIndex));
                        const serviceDate = displayDateForSession(sessionIndex, session);
                        // SRW:824-826 and :846. Admin never disables a card (SRW:833: the public gating needs !readOnly and !adminEditing).
                        const state: DayCardState = adminEditing
                            ? changed ? "changed" : "readonly"
                            : done ? "done" : "readonly";
                        const statusLabel = adminEditing
                            ? changed ? DAY_STATUS_CHANGED : done ? DAY_STATUS_DONE : DAY_STATUS_EDITABLE
                            : done ? DAY_STATUS_DONE : DAY_STATUS_READONLY;
                        return (
                            <DayCard
                                key={sessionIndex}
                                data-component={child("body_day-grid_day")}
                                data-slot="day"
                                state={state}
                                dateLabel={serviceDateDisplay?.({
                                    "data-component": child("body_day-grid_day_date-display"),
                                    sessionIndex,
                                    serviceDate,
                                }) ?? formatShortDate(serviceDate)}
                                title={<span data-component={child("body_day-grid_day_number")}>{sessionIndex}</span>}
                                statusLabel={statusLabel}
                                onClick={() => onOpenDay(sessionIndex, done)}
                            />
                        );
                    })}
                </DayCardGrid>
                {overviewSupplemental}
            </div>
            {adminConfirmAction || adminCommitActions ? (
                <StickyActionBar
                    data-component={child("body_overview-bar")}
                    leading={adminConfirmAction ? (
                        // `contents`: the bar lays the buttons out, the wrapper is only the hook (SRW:858).
                        <div data-component={child("body_overview-actions")} data-slot="overview-actions" className="contents">
                            {adminConfirmAction}
                        </div>
                    ) : undefined}
                >
                    {adminCommitActions ? (
                        <div data-component={child("body_overview-commit")} data-slot="overview-commit" className="contents">
                            {adminCommitActions}
                        </div>
                    ) : null}
                </StickyActionBar>
            ) : null}
        </>
    );
}
