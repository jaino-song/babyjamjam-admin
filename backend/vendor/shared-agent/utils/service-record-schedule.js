"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceRecordScheduleValidationError = void 0;
exports.validateServiceRecordScheduleVector = validateServiceRecordScheduleVector;
exports.shiftServiceRecordScheduleSuffix = shiftServiceRecordScheduleSuffix;
exports.getExpectedSessionDateFromRecords = getExpectedSessionDateFromRecords;
const business_days_1 = require("./business-days");
class ServiceRecordScheduleValidationError extends Error {
    constructor(code, message, sessionIndex = null) {
        super(message);
        this.name = "ServiceRecordScheduleValidationError";
        this.code = code;
        this.sessionIndex = sessionIndex;
    }
}
exports.ServiceRecordScheduleValidationError = ServiceRecordScheduleValidationError;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function assertDateOnly(value, sessionIndex) {
    if (!DATE_ONLY_PATTERN.test(value)) {
        throw new ServiceRecordScheduleValidationError("INVALID_DATE", `Session ${sessionIndex ?? "?"} has an invalid service date`, sessionIndex);
    }
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day) {
        throw new ServiceRecordScheduleValidationError("INVALID_DATE", `Session ${sessionIndex ?? "?"} has an invalid service date`, sessionIndex);
    }
    (0, business_days_1.assertSupportedKoreanHolidayYear)(year);
}
function assertBusinessDate(value, sessionIndex) {
    assertDateOnly(value, sessionIndex);
    if (!(0, business_days_1.isBusinessDayKr)(value)) {
        throw new ServiceRecordScheduleValidationError("NON_BUSINESS_DATE", `Session ${sessionIndex ?? "?"} must use a Korean business day`, sessionIndex);
    }
}
function cloneEntry(entry) {
    return { ...entry };
}
/**
 * Validates a complete authoritative vector before it is persisted or shifted.
 * The function intentionally requires ownership and original-date provenance;
 * callers with legacy rows must first resolve those fields from unique source
 * evidence rather than inventing placeholders.
 */
function validateServiceRecordScheduleVector(entries, requiredSessionCount) {
    const expectedCount = requiredSessionCount ?? entries.length;
    if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
        throw new ServiceRecordScheduleValidationError("INVALID_SESSION_COUNT", "A planned service vector requires a positive session count");
    }
    if (entries.length !== expectedCount) {
        throw new ServiceRecordScheduleValidationError("INCOMPLETE_VECTOR", `Expected ${expectedCount} planned sessions but received ${entries.length}`);
    }
    const orderedEntries = [...entries].sort((left, right) => left.sessionIndex - right.sessionIndex);
    const indices = new Set();
    const dates = new Set();
    let previousDate = null;
    const result = orderedEntries.map((entry) => {
        if (!Number.isInteger(entry.sessionIndex) || entry.sessionIndex < 1 || entry.sessionIndex > expectedCount) {
            throw new ServiceRecordScheduleValidationError("INVALID_SESSION_INDEX", `Session ${String(entry.sessionIndex)} is outside the contracted range 1..${expectedCount}`, Number.isInteger(entry.sessionIndex) ? entry.sessionIndex : null);
        }
        if (indices.has(entry.sessionIndex)) {
            throw new ServiceRecordScheduleValidationError("DUPLICATE_SESSION_INDEX", `Session ${entry.sessionIndex} appears more than once`, entry.sessionIndex);
        }
        indices.add(entry.sessionIndex);
        assertBusinessDate(entry.serviceDate, entry.sessionIndex);
        assertBusinessDate(entry.originalDate, entry.sessionIndex);
        if (dates.has(entry.serviceDate)) {
            throw new ServiceRecordScheduleValidationError("DUPLICATE_SERVICE_DATE", `Session ${entry.sessionIndex} duplicates a service date`, entry.sessionIndex);
        }
        dates.add(entry.serviceDate);
        if (previousDate !== null && entry.serviceDate <= previousDate) {
            throw new ServiceRecordScheduleValidationError("INVERTED_SERVICE_DATES", `Session ${entry.sessionIndex} is not after the previous session`, entry.sessionIndex);
        }
        previousDate = entry.serviceDate;
        if (!entry.assignmentId || typeof entry.assignmentId !== "string") {
            throw new ServiceRecordScheduleValidationError("MISSING_ASSIGNMENT_PROVENANCE", `Session ${entry.sessionIndex} has no assignment id`, entry.sessionIndex);
        }
        if (entry.scheduleId <= 0 || entry.employeeId <= 0 || !Number.isInteger(entry.scheduleId) || !Number.isInteger(entry.employeeId)) {
            throw new ServiceRecordScheduleValidationError("MISSING_ASSIGNMENT_PROVENANCE", `Session ${entry.sessionIndex} has incomplete assignment ownership`, entry.sessionIndex);
        }
        if (!entry.provenanceVersion || typeof entry.provenanceVersion !== "string") {
            throw new ServiceRecordScheduleValidationError("MISSING_PROVENANCE_VERSION", `Session ${entry.sessionIndex} has no provenance version`, entry.sessionIndex);
        }
        return cloneEntry(entry);
    });
    for (let sessionIndex = 1; sessionIndex <= expectedCount; sessionIndex += 1) {
        if (!indices.has(sessionIndex)) {
            throw new ServiceRecordScheduleValidationError("INCOMPLETE_VECTOR", `Session ${sessionIndex} is missing from the planned vector`, sessionIndex);
        }
    }
    result.sort((left, right) => left.sessionIndex - right.sessionIndex);
    return result;
}
/**
 * Shift the selected session and every later session by one signed business
 * day delta. Each original date is retained and each current date is shifted
 * independently, preserving intentionally irregular gaps in the vector.
 */
function shiftServiceRecordScheduleSuffix(entries, sessionIndex, newDate) {
    const vector = validateServiceRecordScheduleVector(entries);
    if (!Number.isInteger(sessionIndex) || sessionIndex < 1 || sessionIndex > vector.length) {
        throw new ServiceRecordScheduleValidationError("INVALID_SESSION_INDEX", `Session ${sessionIndex} is outside the contracted range 1..${vector.length}`, sessionIndex);
    }
    assertBusinessDate(newDate, sessionIndex);
    const currentDate = vector[sessionIndex - 1].serviceDate;
    const deltaBusinessDays = (0, business_days_1.diffBusinessDaysKr)(newDate, currentDate);
    if (deltaBusinessDays === null) {
        throw new ServiceRecordScheduleValidationError("INVALID_DATE", `Unable to calculate a business-day shift for session ${sessionIndex}`, sessionIndex);
    }
    const shifted = vector.map((entry) => {
        if (entry.sessionIndex < sessionIndex)
            return cloneEntry(entry);
        return {
            ...entry,
            serviceDate: (0, business_days_1.shiftBusinessDaysKr)(entry.serviceDate, deltaBusinessDays),
        };
    });
    return { deltaBusinessDays, entries: validateServiceRecordScheduleVector(shifted, vector.length) };
}
const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
function datePartOf(value) {
    if (!value)
        return null;
    const match = value.match(DATE_ONLY_PREFIX);
    return match?.[0] ?? null;
}
/**
 * Finds the highest-indexed written session that still precedes `sessionIndex`.
 * Written sessions need not be contiguous (a gap is fine) — only the closest
 * preceding one matters, since that is what the next slot's date chains from.
 */
function findPrecedingRecord(sessionIndex, records) {
    let preceding = null;
    for (const record of records) {
        if (record.sessionIndex >= sessionIndex)
            continue;
        if (preceding === null || record.sessionIndex > preceding.sessionIndex) {
            preceding = record;
        }
    }
    return preceding;
}
/**
 * Computes the expected (예정일) date for an unwritten session slot.
 *
 * Written slots chain the schedule forward: an unwritten slot's expected
 * date is N business days after the *actual* (possibly postponed) date of
 * the closest preceding written session, matching the caregiver wizard's
 * own scheduling logic. Only when no written session precedes this slot do
 * we fall back to counting business days from the assignment's start date.
 */
function getExpectedSessionDateFromRecords(startDate, sessionIndex, records) {
    const precedingRecord = findPrecedingRecord(sessionIndex, records);
    if (precedingRecord) {
        const precedingDatePart = datePartOf(precedingRecord.serviceDate);
        if (precedingDatePart) {
            return (0, business_days_1.addBusinessDaysKr)(precedingDatePart, sessionIndex - precedingRecord.sessionIndex) || null;
        }
    }
    const startDatePart = datePartOf(startDate);
    if (!startDatePart)
        return null;
    return (0, business_days_1.calcEndDateBusinessDays)(startDatePart, sessionIndex) || null;
}
