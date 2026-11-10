import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { CAREGIVER_DATE_WINDOW_DAYS, resolveServiceRecordScheduleProjection, storedServiceDays } from "./service-record-edit-preview.policy";

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
            const { source } = candidate;
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
            const clientStart = source.client.startDate ?? active.scheduleStartDate;
            const clientEnd = source.client.endDate ?? active.scheduleEndDate;
            if (!validDate(clientStart) || !validDate(clientEnd) || clientStart > clientEnd) continue;
            // mapCase displays stored N independently of client duration/period.
            // Without N, a persisted vector is authoritative but unknown (zero);
            // only a legacy case derives its display total from the case period.
            const total = source.requiredSessionCount ?? (source.plannedSessions != null ? 0
                : serviceRecordSessionCount(new Date(source.startDate), new Date(source.endDate), null, calendar));
            if (total === null || total < 2) continue;
            const projection = resolveServiceRecordScheduleProjection(source, calendar);
            if (projection.blockingReasons.length > 0) continue;
            // The case UI uses the whole projection without renumbering by owner.
            // Only global slot 2 needs a planned date.
            const second = projection.entries.find((entry) => entry.sessionIndex === 2);
            if (!second) continue;
            // mapCase includes all case rows; the card partitions them by the
            // inclusive start−7..end+7 lifecycle window before matching canonical indexes to slots.
            const windowStart = new Date(`${source.startDate}T00:00:00Z`);
            windowStart.setUTCDate(windowStart.getUTCDate() - CAREGIVER_DATE_WINDOW_DAYS);
            const windowEnd = new Date(`${source.endDate}T00:00:00Z`);
            windowEnd.setUTCDate(windowEnd.getUTCDate() + CAREGIVER_DATE_WINDOW_DAYS);
            const windowStartDate = windowStart.toISOString().slice(0, 10);
            const windowEndDate = windowEnd.toISOString().slice(0, 10);
            const written = source.sessions.some((session) => (session.sessionIndex === 1 || session.sessionIndex === 2)
                && validDate(session.serviceDate)
                && session.serviceDate >= windowStartDate && session.serviceDate <= windowEndDate);
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
