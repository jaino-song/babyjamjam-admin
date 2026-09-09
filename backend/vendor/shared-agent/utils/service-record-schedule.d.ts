export interface ServiceRecordScheduleEntry {
    sessionIndex: number;
    serviceDate: string;
}
/** Immutable ownership metadata carried by every authoritative planned slot. */
export interface ServiceRecordScheduleProvenance {
    assignmentId: string;
    scheduleId: number;
    employeeId: number;
    provenanceVersion: string;
}
/** A complete, one-based vector of planned service sessions. */
export interface ServiceRecordPlannedSession extends ServiceRecordScheduleEntry, ServiceRecordScheduleProvenance {
    /** Original date from the first persisted projection; never changes after a move. */
    originalDate: string;
}
export interface ServiceRecordScheduleShiftResult {
    deltaBusinessDays: number;
    entries: ServiceRecordPlannedSession[];
}
export declare class ServiceRecordScheduleValidationError extends Error {
    readonly code: string;
    readonly sessionIndex: number | null;
    constructor(code: string, message: string, sessionIndex?: number | null);
}
/**
 * Validates a complete authoritative vector before it is persisted or shifted.
 * The function intentionally requires ownership and original-date provenance;
 * callers with legacy rows must first resolve those fields from unique source
 * evidence rather than inventing placeholders.
 */
export declare function validateServiceRecordScheduleVector(entries: ReadonlyArray<ServiceRecordPlannedSession>, requiredSessionCount?: number): ServiceRecordPlannedSession[];
/**
 * Shift the selected session and every later session by one signed business
 * day delta. Each original date is retained and each current date is shifted
 * independently, preserving intentionally irregular gaps in the vector.
 */
export declare function shiftServiceRecordScheduleSuffix(entries: ReadonlyArray<ServiceRecordPlannedSession>, sessionIndex: number, newDate: string): ServiceRecordScheduleShiftResult;
/**
 * Computes the expected (예정일) date for an unwritten session slot.
 *
 * Written slots chain the schedule forward: an unwritten slot's expected
 * date is N business days after the *actual* (possibly postponed) date of
 * the closest preceding written session, matching the caregiver wizard's
 * own scheduling logic. Only when no written session precedes this slot do
 * we fall back to counting business days from the assignment's start date.
 */
export declare function getExpectedSessionDateFromRecords(startDate: string | null, sessionIndex: number, records: ReadonlyArray<ServiceRecordScheduleEntry>): string | null;
