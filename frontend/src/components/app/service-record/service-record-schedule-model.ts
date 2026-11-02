import {
    classifyServiceDay,
    createServiceDayPicker,
    revertServiceDayPicker,
    serviceDayPickerProgress,
    setServiceDayPolicy,
    toggleServiceDay,
    type ServiceDayClass,
    type ServiceDayPickerState,
} from "@babyjamjam/shared/utils/service-day-picker";

import {
    AdminServiceRecordEditApiError,
    readServiceRecordScheduleBlockingReasons,
    type ServiceRecordScheduleBlockingReasonRef,
} from "@/features/service-records/types/admin-edit";
import type { KrBusinessDayCalendar, ServiceDayPolicy } from "@/lib/date/business-days";
import { t, type Locale } from "@/lib/i18n/translations";

import {
    buildAdminServiceRecordView,
    readBlockingOperation,
    type AdminServiceRecordEditorOverview,
} from "./ServiceRecordAdminWizard";

const TEXT = "clients.service-record-schedule";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** What the dialog edits: the case's sessions, the dates already written, and the client's toggles. */
export interface ScheduleSource {
    startDate: string;
    requiredCount: number;
    initialDates: string[];
    /** Dates of sessions that are locked or submitted; each stays on its session index. */
    writtenDates: string[];
    policy: ServiceDayPolicy;
}

export type ScheduleSourceResult =
    | { ok: true; source: ScheduleSource }
    | { ok: false; reason: "projection-blocked" | "no-sessions" };

function dateOnly(value: unknown): string {
    return typeof value === "string" && ISO_DATE.test(value) ? value.slice(0, 10) : "";
}

/**
 * Reads the editor overview into what the dialog needs. Anything that does not
 * describe one complete, strictly ascending list of session dates is refused:
 * the dialog replaces the whole list, so it must start from a faithful copy.
 */
export function deriveScheduleSource(overview: AdminServiceRecordEditorOverview): ScheduleSourceResult {
    const entries = overview.scheduleProjection?.entries ?? [];
    if (entries.length === 0) return { ok: false, reason: "no-sessions" };
    const view = buildAdminServiceRecordView(overview);
    if (view.scheduleProjectionBlockingReasons.length > 0 || view.plannedSessions.length === 0) {
        return { ok: false, reason: "projection-blocked" };
    }
    const planned = [...view.plannedSessions].sort((left, right) => left.sessionIndex - right.sessionIndex);
    const initialDates = planned.map((entry) => dateOnly(entry.serviceDate));
    const ascending = initialDates.every((date, index) => date !== "" && (index === 0 || date > initialDates[index - 1]!));
    if (!ascending) return { ok: false, reason: "projection-blocked" };

    const writtenIndexes = new Set(
        view.context.sessions
            .filter((session) => session.locked || session.submittedAt)
            .map((session) => session.sessionIndex),
    );
    const writtenDates = planned
        .filter((entry) => writtenIndexes.has(entry.sessionIndex))
        .map((entry) => dateOnly(entry.serviceDate));
    // The picker treats every earlier day as "before start", so the start can never be later than the first date.
    const caseStart = dateOnly(view.context.startDate);
    const startDate = caseStart !== "" && caseStart < initialDates[0]! ? caseStart : initialDates[0]!;
    return {
        ok: true,
        source: {
            startDate,
            requiredCount: planned.length,
            initialDates,
            writtenDates,
            policy: {
                saturday: overview.serviceDays?.saturday ?? false,
                sunday: overview.serviceDays?.sunday ?? false,
                holiday: overview.serviceDays?.holiday ?? false,
            },
        },
    };
}

/**
 * The shared picker plus the dates that cannot move. The server compares a
 * written session by date AND index, so every date on or before the last
 * written session's date is fixed: neither removed nor added.
 */
export interface ScheduleModel {
    picker: ServiceDayPickerState;
    fixedUntil: string | null;
}

export type ScheduleDayClass = ServiceDayClass | "fixed";

export type ScheduleToggleOutcome = "added" | "removed" | "full" | "not-selectable" | "fixed";

export function createScheduleModel(source: ScheduleSource): ScheduleModel {
    const written = [...source.writtenDates].sort();
    return {
        picker: createServiceDayPicker({
            startDate: source.startDate,
            requiredCount: source.requiredCount,
            initialDates: source.initialDates,
            policy: source.policy,
        }),
        fixedUntil: written.length > 0 ? written[written.length - 1]! : null,
    };
}

/** The calendar every classification uses: the branch calendar under the dialog's current toggles. */
export function scheduleCalendar(model: ScheduleModel, baseCalendar: KrBusinessDayCalendar): KrBusinessDayCalendar {
    return baseCalendar.withServiceDays(model.picker.policy);
}

function isFixedDate(model: ScheduleModel, iso: string): boolean {
    return model.fixedUntil !== null && iso <= model.fixedUntil;
}

export function classifyScheduleDay(model: ScheduleModel, iso: string, calendar: KrBusinessDayCalendar): ScheduleDayClass {
    const picked = classifyServiceDay(model.picker, iso, calendar);
    if (!isFixedDate(model, iso) || picked === "before-start") return picked;
    return picked === "selected" ? "fixed" : "unavailable";
}

export function toggleScheduleDay(
    model: ScheduleModel,
    iso: string,
    calendar: KrBusinessDayCalendar,
): { model: ScheduleModel; outcome: ScheduleToggleOutcome } {
    if (isFixedDate(model, iso)) {
        return { model, outcome: model.picker.selected.includes(iso) ? "fixed" : "not-selectable" };
    }
    const result = toggleServiceDay(model.picker, iso, calendar);
    return { model: { ...model, picker: result.state }, outcome: result.outcome };
}

/**
 * Switches the toggles. Dates the new toggles forbid are dropped, except the
 * fixed ones: those stay selected, because the server accepts an unchanged
 * date and moving it would shift every later session's index.
 */
export function setSchedulePolicy(
    model: ScheduleModel,
    policy: ServiceDayPolicy,
    baseCalendar: KrBusinessDayCalendar,
): { model: ScheduleModel; dropped: string[] } {
    const result = setServiceDayPolicy(model.picker, policy, baseCalendar);
    const restored = result.dropped.filter((iso) => isFixedDate(model, iso));
    const selected = [...new Set([...result.state.selected, ...restored])].sort();
    return {
        model: { ...model, picker: { ...result.state, selected } },
        dropped: result.dropped.filter((iso) => !isFixedDate(model, iso)),
    };
}

/** Back to the state when the dialog opened, toggles included. */
export function revertSchedule(model: ScheduleModel): ScheduleModel {
    return { ...model, picker: revertServiceDayPicker(model.picker) };
}

/**
 * Save is allowed only when `complete`. A fixed date is never counted as
 * invalid: it cannot be changed, and the server accepts it as it stands.
 */
export function scheduleProgress(
    model: ScheduleModel,
    calendar: KrBusinessDayCalendar,
): { selectedCount: number; requiredCount: number; invalid: string[]; complete: boolean } {
    const editable = model.picker.selected.filter((iso) => !isFixedDate(model, iso));
    const { invalid } = serviceDayPickerProgress({ ...model.picker, selected: editable }, calendar);
    const selectedCount = model.picker.selected.length;
    return {
        selectedCount,
        requiredCount: model.picker.requiredCount,
        invalid,
        complete: selectedCount === model.picker.requiredCount && invalid.length === 0,
    };
}

/** True when the dialog's choices differ from what it opened with. */
export function isScheduleChanged(model: ScheduleModel): boolean {
    const { picker } = model;
    return picker.selected.length !== picker.initial.length
        || picker.selected.some((iso, index) => iso !== picker.initial[index])
        || picker.policy.saturday !== picker.initialPolicy.saturday
        || picker.policy.sunday !== picker.initialPolicy.sunday
        || picker.policy.holiday !== picker.initialPolicy.holiday;
}

// ---------------------------------------------------------------------------
// Failure copy
// ---------------------------------------------------------------------------

function lookup(locale: Locale, key: string): string | null {
    const value = t(locale, key);
    return value === key ? null : value;
}

function reasonMessage(locale: Locale, reasons: readonly ServiceRecordScheduleBlockingReasonRef[]): string | null {
    for (const reason of reasons) {
        const message = lookup(locale, `${TEXT}.errors.blocking.${reason.code}`);
        if (message) return message;
    }
    return null;
}

/** Korean copy for the blocking reasons of a preview. Unknown codes read as the generic failure. */
export function scheduleBlockingReasonsMessage(
    locale: Locale,
    reasons: readonly { code: string; sessionIndex?: number }[],
): string {
    return reasonMessage(locale, reasons) ?? t(locale, `${TEXT}.errors.generic`);
}

/** Korean copy for a failed schedule request; never the upstream wording. */
export function scheduleFailureMessage(locale: Locale, failure: unknown): string {
    if (!(failure instanceof AdminServiceRecordEditApiError)) return t(locale, `${TEXT}.errors.generic`);
    if (failure.status === 401) return t(locale, `${TEXT}.errors.unauthenticated`);
    if (failure.status === 403) return t(locale, `${TEXT}.errors.forbidden`);
    if (failure.status === 409 && readBlockingOperation(failure.body)) {
        return t(locale, `${TEXT}.errors.blocking-operation`);
    }
    const blocking = reasonMessage(locale, readServiceRecordScheduleBlockingReasons(failure.body));
    if (blocking) return blocking;
    const code = failure.scheduleCode;
    const byCode = code ? lookup(locale, `${TEXT}.errors.schedule.${code}`) : null;
    if (byCode) return byCode;
    return failure.status === 409
        ? t(locale, `${TEXT}.errors.conflict`)
        : t(locale, `${TEXT}.errors.generic`);
}
