import {
    hasServiceDaysForGap,
    previousBusinessDay,
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";
import { UnsupportedKoreanHolidayYearError, type KrBusinessDayCalendar } from "domain/utils/business-days";

export class CaregiverDateAlignmentError extends Error {
    constructor(readonly direction: "forward" | "backward") {
        super(`Caregiver date alignment collided ${direction}`);
        this.name = "CaregiverDateAlignmentError";
    }
}

function calendarDay(iso: string, offset: number): string {
    const date = new Date(`${iso}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

/** Stored rows include drafts and use the caller's normalized legacy index. */
export function hasRoomForCaregiverDate(
    rows: ReadonlyArray<{ caseSessionIndex: number; serviceDate: Date }>,
    sessionIndex: number,
    serviceDate: string,
    calendar: KrBusinessDayCalendar,
    startDate: Date | null,
    endDate: Date | null,
): boolean {
    return hasServiceDaysForGap({
        rows: rows.map((row) => ({ sessionIndex: row.caseSessionIndex, serviceDate: row.serviceDate.toISOString().slice(0, 10) })),
        sessionIndex, serviceDate, calendar,
        first: startDate ? calendarDay(startDate.toISOString().slice(0, 10), -7) : null,
        last: endDate ? calendarDay(endDate.toISOString().slice(0, 10), 7) : null,
    });
}

/** Repair only adjacent unwritten slots; written dates are immovable boundaries. */
export function alignPlannedSessionsToCaregiverDate(
    entries: ReadonlyArray<ServiceRecordPlannedSession>,
    sessionIndex: number,
    dateIso: string,
    writtenIndexes: ReadonlySet<number>,
    calendar: KrBusinessDayCalendar,
): ServiceRecordPlannedSession[] {
    const aligned = entries.map((entry) => ({ ...entry })).sort((a, b) => a.sessionIndex - b.sessionIndex);
    const target = aligned.findIndex((entry) => entry.sessionIndex === sessionIndex);
    if (target < 0) throw new Error("Planned session is missing");
    aligned[target]!.serviceDate = dateIso;
    const step = (iso: string, direction: 1 | -1): string => {
        try {
            return direction === 1 ? calendar.addBusinessDays(iso, 1) : previousBusinessDay(iso, calendar);
        } catch (error) {
            if (!(error instanceof UnsupportedKoreanHolidayYearError)) throw error;
            return calendarDay(iso, direction);
        }
    };
    for (let k = target + 1; k < aligned.length; k++) {
        const entry = aligned[k]!;
        const prev = aligned[k - 1]!;
        if (writtenIndexes.has(entry.sessionIndex) || entry.serviceDate > prev.serviceDate) break;
        entry.serviceDate = step(prev.serviceDate, 1);
    }
    for (let k = target - 1; k >= 0; k--) {
        const entry = aligned[k]!;
        const next = aligned[k + 1]!;
        if (writtenIndexes.has(entry.sessionIndex) || entry.serviceDate < next.serviceDate) break;
        entry.serviceDate = step(next.serviceDate, -1);
    }
    try {
        return validateServiceRecordScheduleVector(aligned, entries.length, calendar, { persisted: true });
    } catch (error) {
        const collision = aligned.findIndex((entry, k) => k > 0 && entry.serviceDate <= aligned[k - 1]!.serviceDate);
        if (collision >= 0) throw new CaregiverDateAlignmentError(collision > target ? "forward" : "backward");
        throw error;
    }
}
