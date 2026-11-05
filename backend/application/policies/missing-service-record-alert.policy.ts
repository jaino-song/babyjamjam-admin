import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { resolveServiceRecordScheduleProjection, storedServiceDays } from "./service-record-edit-preview.policy";

export interface MissingServiceRecordAlert {
    clientId: number;
    clientName: string;
    primaryEmployeeName: string;
    scheduleId: number;
}

function validDate(value: string | null): value is string {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const millis = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}

/** Mirrors the first-two-unwritten warning, using the editor's authoritative schedule. */
export function findMissingServiceRecordAlerts(
    candidates: ServiceRecordAlertCandidate[],
    branchId: string,
    branchCalendar: KrBusinessDayCalendar,
    now: Date,
): MissingServiceRecordAlert[] {
    const alerts = new Map<number, MissingServiceRecordAlert>();
    for (const candidate of candidates) {
        // Bad/unsupported source evidence must not prevent other clients' alerts.
        try {
            const { source, assignmentSessions } = candidate;
            if (source.client.branchId !== branchId || !source.client.name.trim()
                || !validDate(source.startDate) || !validDate(source.endDate)
                || source.startDate > source.endDate) continue;
            if (source.assignments.some((assignment) => assignment.branchId !== branchId
                || assignment.serviceRecordCaseId !== source.caseId
                || !validDate(assignment.startDate) || !validDate(assignment.endDate)
                || !validDate(assignment.scheduleStartDate) || !validDate(assignment.scheduleEndDate))) continue;
            const active = [...source.assignments]
                .sort((left, right) => right.scheduleStartDate.localeCompare(left.scheduleStartDate)
                    || (right.scheduleId ?? 0) - (left.scheduleId ?? 0))
                .find((assignment) => !assignment.replaced);
            if (!active?.id || active.scheduleId === null || !active.primaryEmployeeName?.trim()) continue;
            const calendar = branchCalendar.withServiceDays(storedServiceDays(source));
            const start = source.client.startDate ?? active.scheduleStartDate;
            const end = source.client.endDate ?? active.scheduleEndDate;
            if (!validDate(start) || !validDate(end) || start > end) continue;
            const total = serviceRecordSessionCount(new Date(start), new Date(end), source.client.duration, calendar);
            if (total === null || total < 2) continue;
            const projection = resolveServiceRecordScheduleProjection(source, calendar);
            if (projection.blockingReasons.length > 0) continue;
            // The UI keeps projected indexes after filtering by schedule; it never
            // renumbers later entries into slots 1 and 2. Only slot 2 needs a planned date.
            const second = projection.entries.find((entry) => entry.scheduleId === active.scheduleId && entry.sessionIndex === 2);
            if (!second) continue;
            const written = assignmentSessions.some((session) => session.scheduleId === active.scheduleId
                && (session.sessionIndex === 1 || session.sessionIndex === 2)
                && validDate(session.serviceDate)
                && session.serviceDate >= active.scheduleStartDate && session.serviceDate <= active.scheduleEndDate);
            if (written) continue;
            const secondDate = second.serviceDate;
            if (!validDate(secondDate)) continue;
            const threshold = Date.parse(`${secondDate}T18:00:00+09:00`);
            if (!(now.getTime() >= threshold)) continue;
            alerts.set(source.client.id, {
                clientId: source.client.id, clientName: source.client.name,
                primaryEmployeeName: active.primaryEmployeeName, scheduleId: active.scheduleId,
            });
        } catch {
            // Fail closed for invalid vectors and unsupported holiday years. No PII logs.
        }
    }
    return [...alerts.values()];
}
