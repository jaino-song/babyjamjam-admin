import type { KrBusinessDayCalendar } from "@babyjamjam/shared/utils/business-days";
import {
    getExpectedSessionDateFromRecords,
    ServiceRecordScheduleValidationError,
    type ServiceRecordPlannedSession as SharedPlannedSession,
    validateServiceRecordScheduleVector,
    shiftServiceRecordScheduleSuffix,
    moveServiceRecordSessionDate,
} from "@babyjamjam/shared/utils/service-record-schedule";
import type {
    ServiceRecordEditDocumentScope,
    ServiceRecordEditPreviewAssignmentRange,
    ServiceRecordEditPreviewBlockingReason,
    ServiceRecordEditPreviewContentChanges,
    ServiceRecordEditPreviewResponse,
    ServiceRecordEditPreviewVector,
    ServiceRecordEditSignatureMetadata,
    ServiceRecordPlannedSession,
} from "@babyjamjam/shared/types/service-record";

import type {
    ServiceRecordEditJsonObject,
    ServiceRecordEditJsonValue,
    ServiceRecordEditSource,
    ServiceRecordEditSourceAssignment,
    ServiceRecordEditSourceDay,
} from "domain/repositories/service-record-edit.repository.interface";

export { ServiceRecordScheduleValidationError } from "@babyjamjam/shared/utils/service-record-schedule";

interface DraftSessionChange {
    sessionIndex: number;
    [key: string]: ServiceRecordEditJsonValue | number;
}

interface CanonicalProjection {
    entries: SharedPlannedSession[];
    source: "planned" | "legacy";
    blockingReasons: ServiceRecordEditPreviewBlockingReason[];
}

export interface DraftNormalizationResult {
    changes: ServiceRecordEditJsonObject;
    entries: SharedPlannedSession[] | null;
}

export interface ServiceRecordEditDateMove {
    sessionIndex: number;
    toDate: string;
    shiftFollowing?: boolean;
}

export interface ServiceRecordEditPreviewBuildInput {
    draftId: string;
    draftVersion: number;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    source: ServiceRecordEditSource;
    changes: ServiceRecordEditJsonValue;
    previewId: string;
    calendar: KrBusinessDayCalendar;
}

function isRecord(value: ServiceRecordEditJsonValue | unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: ServiceRecordEditJsonValue | undefined): Record<string, ServiceRecordEditJsonValue> | null {
    return isRecord(value) ? value as Record<string, ServiceRecordEditJsonValue> : null;
}

function asArray(value: ServiceRecordEditJsonValue | undefined): ServiceRecordEditJsonValue[] | null {
    return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function reason(
    code: string,
    message: string,
    sessionIndex?: number,
    assignmentId?: string,
): ServiceRecordEditPreviewBlockingReason {
    return {
        code,
        message,
        ...(sessionIndex === undefined ? {} : { sessionIndex }),
        ...(assignmentId === undefined ? {} : { assignmentId }),
    };
}

function reasonFromError(error: unknown, fallbackSessionIndex?: number): ServiceRecordEditPreviewBlockingReason {
    if (error instanceof ServiceRecordScheduleValidationError) {
        return reason(error.code, error.message, error.sessionIndex ?? fallbackSessionIndex);
    }
    if (error instanceof Error) return reason("INVALID_SCHEDULE_VECTOR", error.message, fallbackSessionIndex);
    return reason("INVALID_SCHEDULE_VECTOR", "서비스 예정일 벡터를 계산할 수 없습니다.", fallbackSessionIndex);
}

function assignmentById(source: ServiceRecordEditSource, assignmentId: string): ServiceRecordEditSourceAssignment | null {
    return source.assignments.find((assignment) => assignment.id === assignmentId) ?? null;
}

/**
 * Resolve which assignment owns a legacy session, in this order:
 * 0. (projectLegacy, before this lookup) a session with no row at all that
 *    follows the current assignee's backfill belongs to the current assignee;
 *    see currentBackfill.
 * 1. A written row belongs to the assignment of the schedule that wrote it
 *    (the employee must match when both sides name one). No date check, so
 *    rows backfilled before that assignment's own start date keep working.
 * 2. Otherwise (unwritten row, or a row whose schedule id was nulled) the
 *    assignment whose date range contains the session date owns it, limited
 *    to the row's employee when it names one. This keeps a replaced
 *    caregiver's unwritten sessions with that caregiver instead of silently
 *    handing them to the current assignee.
 * 3. If the date matches zero or several assignments (the handover day, or a
 *    date outside every range) the unique non-replaced assignment owns it.
 * 4. Anything else resolves to null so the caller reports
 *    MISSING_ASSIGNMENT_PROVENANCE.
 */
function assignmentForSession(
    source: ServiceRecordEditSource,
    scheduleId: number | null,
    employeeId: number | null,
    serviceDate: string,
): ServiceRecordEditSourceAssignment | null {
    const employeeMatches = (assignment: ServiceRecordEditSourceAssignment) =>
        employeeId === null || assignment.employeeId === null || assignment.employeeId === employeeId;
    const identified = source.assignments.filter((assignment) => Boolean(assignment.id));

    if (scheduleId !== null) {
        const bySchedule = identified.filter((assignment) =>
            assignment.scheduleId === scheduleId && employeeMatches(assignment));
        return bySchedule.length === 1 ? bySchedule[0]! : null;
    }

    const eligible = identified.filter(employeeMatches);
    const byDate = eligible.filter((assignment) => {
        const startDate = assignment.startDate || assignment.scheduleStartDate;
        const endDate = assignment.endDate || assignment.scheduleEndDate;
        return Boolean(startDate) && Boolean(endDate) && startDate! <= serviceDate && serviceDate <= endDate!;
    });
    if (byDate.length === 1) return byDate[0]!;

    const current = eligible.filter((assignment) => !assignment.replaced);
    return current.length === 1 ? current[0]! : null;
}

/**
 * Write authority belongs to the currently assigned caregiver, so a newly
 * assigned caregiver may backfill sessions that precede its own start date.
 * Once it has done so (it owns a written row dated before its stored start),
 * every later session with no row at all is part of that backfill rather than
 * the outgoing caregiver's leftover. Without this, date lookup would hand the
 * unwritten sessions that sit between the backfilled ones and the handover to
 * the outgoing caregiver and produce overlapping assignment ranges.
 *
 * `fromIndex` is the first session index the current caregiver backfilled;
 * sessions after it with no row belong to the current assignment. A caregiver
 * that only wrote sessions inside its own range has not started a backfill.
 */
function currentBackfill(
    source: ServiceRecordEditSource,
): { assignment: ServiceRecordEditSourceAssignment; fromIndex: number } | null {
    const current = source.assignments.filter((assignment) =>
        Boolean(assignment.id) && assignment.scheduleId !== null && !assignment.replaced);
    if (current.length !== 1) return null;
    const assignment = current[0]!;
    const startDate = assignment.startDate || assignment.scheduleStartDate;
    if (!startDate) return null;
    let fromIndex: number | null = null;
    for (const session of source.sessions) {
        if (session.ambiguous || session.scheduleId !== assignment.scheduleId) continue;
        if (session.serviceDate < startDate && (fromIndex === null || session.sessionIndex < fromIndex)) {
            fromIndex = session.sessionIndex;
        }
    }
    return fromIndex === null ? null : { assignment, fromIndex };
}

function provenanceVersion(raw: unknown, source: ServiceRecordEditSource): string {
    if (typeof raw === "string" && raw.length > 0) return raw;
    if (typeof raw === "number" && Number.isInteger(raw)) return String(raw);
    return `case-${source.caseVersion}`;
}

function sourceAssignmentEntry(
    source: ServiceRecordEditSource,
    sessionIndex: number,
    serviceDate: string,
    originalDate: string,
    assignment: ServiceRecordEditSourceAssignment | null,
    explicit: { scheduleId?: number | null; employeeId?: number | null; provenanceVersion?: unknown } = {},
): SharedPlannedSession | ServiceRecordEditPreviewBlockingReason {
    if (!assignment?.id || assignment.scheduleId === null || assignment.employeeId === null) {
        return reason(
            "MISSING_ASSIGNMENT_PROVENANCE",
            `Session ${sessionIndex} has no uniquely-owned service-record assignment`,
            sessionIndex,
            assignment?.id ?? undefined,
        );
    }
    if (explicit.scheduleId !== undefined && explicit.scheduleId !== null && explicit.scheduleId !== assignment.scheduleId) {
        return reason(
            "ASSIGNMENT_PROVENANCE_MISMATCH",
            `Session ${sessionIndex} does not match its persisted schedule assignment`,
            sessionIndex,
            assignment.id,
        );
    }
    if (explicit.employeeId !== undefined && explicit.employeeId !== null && explicit.employeeId !== assignment.employeeId) {
        return reason(
            "ASSIGNMENT_PROVENANCE_MISMATCH",
            `Session ${sessionIndex} does not match its persisted employee assignment`,
            sessionIndex,
            assignment.id,
        );
    }
    return {
        sessionIndex,
        serviceDate,
        originalDate,
        assignmentId: assignment.id,
        scheduleId: assignment.scheduleId,
        employeeId: assignment.employeeId,
        provenanceVersion: provenanceVersion(explicit.provenanceVersion, source),
    };
}

/**
 * A caregiver may write over a slot the vector gives to an earlier one: write
 * authority moved forward, never back. The planned owner therefore has to have
 * been replaced and the writer's schedule has to come after the owner's.
 * Schedule ids are autoincrement, so "later" is "greater id" (the same order
 * the token service uses to pick the current caregiver). Stored assignment
 * dates are record-only and never decide this: they may legitimately overlap
 * (a caregiver replaced before her own start is stored as [start, start]).
 * Twin of isBackfilledBySuccessor in service-record-finalization.service.ts.
 */
function isSuccessorOf(
    writer: ServiceRecordEditSourceAssignment,
    planned: ServiceRecordEditSourceAssignment,
): boolean {
    return planned.replaced
        && writer.id !== planned.id
        && writer.scheduleId !== null
        && planned.scheduleId !== null
        && writer.scheduleId > planned.scheduleId;
}

/**
 * A persisted vector attributes each slot to the assignment that owned it when
 * the vector was written. Write authority then moved to later caregivers, who
 * may backfill a slot the vector still attributes to an earlier, replaced one.
 * When the row for a slot was written by a successor of the vector's owner,
 * that writer owns the slot. The writer must be the single assignment matching
 * the row's schedule (and employee when the row names one). Any other
 * disagreement between a row and the vector is left for persistedDayReasons to
 * block, and the vector's dates are never changed here.
 */
function backfillWriter(
    source: ServiceRecordEditSource,
    entry: SharedPlannedSession,
): ServiceRecordEditSourceAssignment | null {
    const rows = source.sessions.filter((session) => session.sessionIndex === entry.sessionIndex);
    const row = rows.length === 1 ? rows[0]! : null;
    if (!row || row.ambiguous || row.scheduleId === null) return null;
    if (row.scheduleId === entry.scheduleId && (row.employeeId === null || row.employeeId === entry.employeeId)) {
        return null;
    }
    const planned = assignmentById(source, entry.assignmentId);
    if (!planned) return null;
    const writers = source.assignments.filter((assignment) =>
        Boolean(assignment.id)
        && assignment.scheduleId === row.scheduleId
        && (row.employeeId === null || assignment.employeeId === row.employeeId));
    const writer = writers.length === 1 ? writers[0]! : null;
    if (!writer?.id || writer.scheduleId === null || writer.employeeId === null) return null;
    return isSuccessorOf(writer, planned) ? writer : null;
}

function attributedTo(entry: SharedPlannedSession, writer: ServiceRecordEditSourceAssignment): SharedPlannedSession {
    return {
        ...entry,
        assignmentId: writer.id!,
        scheduleId: writer.scheduleId!,
        employeeId: writer.employeeId!,
    };
}

/**
 * Re-attribute the slots a later caregiver backfilled. A slot with no row
 * that the vector gives to an earlier replaced caregiver follows the writer of
 * the nearest preceding backfilled row, provided that writer is a successor of
 * the slot's vector owner: write authority never interleaves, so the slots
 * between and after backfilled ones belong to whoever backfilled last. Without
 * this the earlier caregiver's leftover slots would straddle the backfilled
 * ones and overlap their ranges. Everything else keeps its vector owner.
 */
function reattributedBackfill(
    source: ServiceRecordEditSource,
    entries: SharedPlannedSession[],
): SharedPlannedSession[] {
    let nearest: ServiceRecordEditSourceAssignment | null = null;
    return [...entries]
        .sort((left, right) => left.sessionIndex - right.sessionIndex)
        .map((entry) => {
            const writer = backfillWriter(source, entry);
            if (writer) {
                nearest = writer;
                return attributedTo(entry, writer);
            }
            if (!nearest || source.sessions.some((session) => session.sessionIndex === entry.sessionIndex)) return entry;
            const owner = assignmentById(source, entry.assignmentId);
            return owner && isSuccessorOf(nearest, owner) ? attributedTo(entry, nearest) : entry;
        });
}

function persistedDayReasons(
    source: ServiceRecordEditSource,
    entries: SharedPlannedSession[],
): ServiceRecordEditPreviewBlockingReason[] {
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    for (const entry of entries) {
        const rows = source.sessions.filter((session) => session.sessionIndex === entry.sessionIndex);
        if (rows.length > 1 || rows.some((row) => row.ambiguous)) {
            blockingReasons.push(reason(
                "AMBIGUOUS_ACTUAL_DAY",
                `Session ${entry.sessionIndex} has multiple or ambiguous actual service rows`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
            continue;
        }
        const row = rows[0];
        if (!row) continue;
        if (row.serviceDate !== entry.serviceDate) {
            blockingReasons.push(reason(
                "ACTUAL_DAY_CONTRADICTION",
                `Session ${entry.sessionIndex} does not match its persisted planned date`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
        if (row.scheduleId !== null && row.scheduleId !== entry.scheduleId) {
            blockingReasons.push(reason(
                "ASSIGNMENT_PROVENANCE_MISMATCH",
                `Session ${entry.sessionIndex} does not match its persisted schedule row`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
        if (row.employeeId !== null && row.employeeId !== entry.employeeId) {
            blockingReasons.push(reason(
                "ASSIGNMENT_PROVENANCE_MISMATCH",
                `Session ${entry.sessionIndex} does not match its persisted employee row`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
    }
    return blockingReasons;
}

/**
 * Keep each planned slot with its persisted assignment. Moving a suffix may
 * expand an assignment's old interval, but it must not silently hand a slot
 * to another provider; the confirm path derives the new owned range and
 * rejects overlapping assignment ranges.
 */
function assignmentRangeReasons(
    source: ServiceRecordEditSource,
    entries: SharedPlannedSession[],
): ServiceRecordEditPreviewBlockingReason[] {
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    const byAssignment = new Map<string, SharedPlannedSession[]>();
    for (const entry of entries) {
        const rows = byAssignment.get(entry.assignmentId) ?? [];
        rows.push(entry);
        byAssignment.set(entry.assignmentId, rows);
    }

    const ranges: Array<{ assignmentId: string; startDate: string; endDate: string }> = [];
    for (const [assignmentId, rows] of byAssignment) {
        const assignment = assignmentById(source, assignmentId);
        if (!assignment) {
            blockingReasons.push(reason(
                "MISSING_ASSIGNMENT_PROVENANCE",
                `Assignment ${assignmentId} is no longer present in the source case`,
                rows[0]?.sessionIndex,
                assignmentId,
            ));
            continue;
        }
        const startDate = assignment.startDate || assignment.scheduleStartDate;
        const endDate = assignment.endDate || assignment.scheduleEndDate;
        if (!startDate || !endDate || startDate > endDate) {
            blockingReasons.push(reason(
                "INVALID_ASSIGNMENT_RANGE",
                `Assignment ${assignmentId} has an invalid source date range`,
                rows[0]?.sessionIndex,
                assignmentId,
            ));
            continue;
        }
        // Persisted ownership remains authoritative even when a date move
        // expands the old schedule interval. The confirm path derives the
        // replacement assignment range from these owned entries; changing the
        // provider here would be an unsafe implicit reassignment.
        ranges.push({
            assignmentId,
            startDate: rows.reduce((min, row) => row.serviceDate < min ? row.serviceDate : min, rows[0]!.serviceDate),
            endDate: rows.reduce((max, row) => row.serviceDate > max ? row.serviceDate : max, rows[0]!.serviceDate),
        });
    }

    ranges.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
    for (let index = 1; index < ranges.length; index += 1) {
        const previous = ranges[index - 1]!;
        const current = ranges[index]!;
        if (current.startDate <= previous.endDate) {
            blockingReasons.push(reason(
                "ASSIGNMENT_RANGE_OVERLAP",
                `Assignments ${previous.assignmentId} and ${current.assignmentId} have overlapping planned ranges`,
                undefined,
                current.assignmentId,
            ));
        }
    }
    return blockingReasons;
}

function plannedArray(source: ServiceRecordEditSource): ServiceRecordEditJsonValue[] | null {
    const raw = source.plannedSessions;
    if (raw === null) return null;
    if (Array.isArray(raw)) return raw;
    if (!isRecord(raw)) return [];
    const record = raw as Record<string, ServiceRecordEditJsonValue>;
    return asArray(record["sessions"])
        ?? asArray(record["entries"])
        ?? asArray(record["plannedSessions"])
        ?? [];
}

function projectPersisted(
    source: ServiceRecordEditSource,
    rawEntries: ServiceRecordEditJsonValue[],
    calendar: KrBusinessDayCalendar,
): CanonicalProjection {
    const expected = source.requiredSessionCount;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected <= 0) {
        return {
            entries: [],
            source: "planned",
            blockingReasons: [reason("INVALID_SESSION_COUNT", "서비스 제공 회차 수 N이 초기화되지 않았습니다.")],
        };
    }
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    const entries: SharedPlannedSession[] = [];
    for (const raw of rawEntries) {
        const record = asRecord(raw);
        const sessionIndex = numberValue(record?.["sessionIndex"]);
        const serviceDate = stringValue(record?.["serviceDate"]);
        const originalDate = stringValue(record?.["originalDate"]);
        const assignmentId = stringValue(record?.["assignmentId"]);
        const nestedProvenance = asRecord(record?.["provenance"]);
        const scheduleId = numberValue(record?.["scheduleId"] ?? nestedProvenance?.["scheduleId"]);
        const employeeId = numberValue(record?.["employeeId"] ?? nestedProvenance?.["employeeId"]);
        const explicitProvenanceVersion = record?.["provenanceVersion"]
            ?? nestedProvenance?.["version"]
            ?? record?.["version"];
        if (
            sessionIndex === null
            || !serviceDate
            || !originalDate
            || !assignmentId
            || scheduleId === null
            || employeeId === null
            || (typeof explicitProvenanceVersion !== "string" && typeof explicitProvenanceVersion !== "number")
        ) {
            blockingReasons.push(reason(
                "INCOMPLETE_VECTOR",
                "저장된 예정 회차에 날짜 또는 배정 귀속이 없습니다.",
                sessionIndex ?? undefined,
            ));
            continue;
        }
        const assignment = assignmentById(source, assignmentId);
        const entry = sourceAssignmentEntry(source, sessionIndex, serviceDate, originalDate, assignment, {
            scheduleId,
            employeeId,
            provenanceVersion: explicitProvenanceVersion,
        });
        if ("code" in entry) blockingReasons.push(entry);
        else entries.push(entry);
    }
    if (blockingReasons.length > 0) return { entries: [], source: "planned", blockingReasons };
    try {
        const validated = validateServiceRecordScheduleVector(
            reattributedBackfill(source, entries),
            expected,
            calendar,
            { persisted: true },
        );
        const rangeBlockingReasons = [
            ...persistedDayReasons(source, validated),
            ...assignmentRangeReasons(source, validated),
        ];
        return {
            entries: rangeBlockingReasons.length > 0 ? [] : validated,
            source: "planned",
            blockingReasons: rangeBlockingReasons,
        };
    } catch (error) {
        return { entries: [], source: "planned", blockingReasons: [reasonFromError(error)] };
    }
}

function projectLegacy(source: ServiceRecordEditSource, calendar: KrBusinessDayCalendar): CanonicalProjection {
    const expected = source.requiredSessionCount;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected <= 0) {
        return {
            entries: [],
            source: "legacy",
            blockingReasons: [reason("INVALID_SESSION_COUNT", "서비스 제공 회차 수 N이 초기화되지 않았습니다.")],
        };
    }
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    const byIndex = new Map<number, ServiceRecordEditSourceDay[]>();
    for (const session of source.sessions) {
        if (!Number.isInteger(session.sessionIndex) || session.sessionIndex < 1 || session.sessionIndex > expected) {
            blockingReasons.push(reason(
                "SESSION_OUTSIDE_CONTRACT",
                `Legacy session ${session.sessionIndex} is outside the contracted range 1..${expected}`,
                session.sessionIndex,
            ));
            continue;
        }
        const rows = byIndex.get(session.sessionIndex) ?? [];
        rows.push(session);
        byIndex.set(session.sessionIndex, rows);
    }
    const records = source.sessions.filter((session) => !session.ambiguous).map((session) => ({
        sessionIndex: session.sessionIndex,
        serviceDate: session.serviceDate,
    }));
    const backfill = currentBackfill(source);
    const entries: SharedPlannedSession[] = [];
    for (let sessionIndex = 1; sessionIndex <= expected; sessionIndex += 1) {
        const rows = byIndex.get(sessionIndex) ?? [];
        if (rows.length > 1 || rows.some((row) => row.ambiguous)) {
            blockingReasons.push(reason(
                "AMBIGUOUS_LEGACY_PROVENANCE",
                `Session ${sessionIndex} has ambiguous legacy source rows`,
                sessionIndex,
            ));
            continue;
        }
        const row = rows[0];
        let serviceDate = row?.serviceDate ?? null;
        if (!serviceDate) {
            if (!source.startDate) {
                blockingReasons.push(reason("MISSING_START_DATE", `Session ${sessionIndex} has no source start date`, sessionIndex));
                continue;
            }
            try {
                serviceDate = getExpectedSessionDateFromRecords(source.startDate, sessionIndex, records, calendar);
            } catch (error) {
                blockingReasons.push(reasonFromError(error, sessionIndex));
                continue;
            }
            if (!serviceDate) {
                blockingReasons.push(reason("MISSING_PLANNED_DATE", `Session ${sessionIndex} has no planned service date`, sessionIndex));
                continue;
            }
        }
        const assignment = !row && backfill && sessionIndex > backfill.fromIndex
            ? backfill.assignment
            : assignmentForSession(source, row?.scheduleId ?? null, row?.employeeId ?? null, serviceDate);
        const entry = sourceAssignmentEntry(source, sessionIndex, serviceDate, serviceDate, assignment, {
            scheduleId: row?.scheduleId,
            employeeId: row?.employeeId,
        });
        if ("code" in entry) blockingReasons.push(entry);
        else entries.push(entry);
    }
    if (blockingReasons.length > 0) return { entries: [], source: "legacy", blockingReasons };
    try {
        const validated = validateServiceRecordScheduleVector(entries, expected, calendar, { persisted: true });
        const rangeBlockingReasons = assignmentRangeReasons(source, validated);
        return {
            entries: rangeBlockingReasons.length > 0 ? [] : validated,
            source: "legacy",
            blockingReasons: rangeBlockingReasons,
        };
    } catch (error) {
        return { entries: [], source: "legacy", blockingReasons: [reasonFromError(error)] };
    }
}

/** Resolve the source's persisted vector, or a complete uniquely-owned legacy projection. */
export function resolveServiceRecordScheduleProjection(
    source: ServiceRecordEditSource,
    calendar: KrBusinessDayCalendar,
): CanonicalProjection {
    const persisted = plannedArray(source);
    if (persisted !== null) return projectPersisted(source, persisted, calendar);
    return projectLegacy(source, calendar);
}

function sessionChanges(value: ServiceRecordEditJsonValue | undefined): DraftSessionChange[] {
    const records = asArray(value) ?? [];
    return records
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, ServiceRecordEditJsonValue> => item !== null)
        .map((item) => {
            const sessionIndex = numberValue(item["sessionIndex"]);
            return sessionIndex === null ? null : { ...item, sessionIndex };
        })
        .filter((item): item is DraftSessionChange => item !== null);
}

function mergedContentChanges(
    previous: DraftSessionChange[],
    incoming: DraftSessionChange[],
): Map<number, DraftSessionChange> {
    const merged = new Map<number, DraftSessionChange>();
    for (const change of [...previous, ...incoming]) {
        const current = merged.get(change.sessionIndex) ?? { sessionIndex: change.sessionIndex };
        for (const [key, value] of Object.entries(change)) {
            if (key !== "sessionIndex" && key !== "serviceDate") current[key] = value;
        }
        merged.set(change.sessionIndex, current);
    }
    return merged;
}

function currentDateOverrides(
    entries: SharedPlannedSession[],
    changes: DraftSessionChange[],
): SharedPlannedSession[] {
    const overrides = new Map(changes
        .filter((change) => typeof change["serviceDate"] === "string")
        .map((change) => [change.sessionIndex, change["serviceDate"] as string]));
    return entries.map((entry) => ({
        ...entry,
        serviceDate: overrides.get(entry.sessionIndex) ?? entry.serviceDate,
    }));
}

function normalizedSessionChanges(
    sourceEntries: SharedPlannedSession[],
    previous: DraftSessionChange[],
    incoming: DraftSessionChange[],
    calendar: KrBusinessDayCalendar,
): DraftSessionChange[] {
    const content = mergedContentChanges(previous, incoming);
    const dateOverrides = new Map<number, string>();
    for (const change of previous) {
        if (typeof change["serviceDate"] === "string") dateOverrides.set(change.sessionIndex, change["serviceDate"] as string);
    }
    let vector = currentDateOverrides(sourceEntries, previous);
    for (const change of incoming) {
        if (typeof change["serviceDate"] !== "string") continue;
        const shifted = shiftServiceRecordScheduleSuffix(
            vector,
            change.sessionIndex,
            change["serviceDate"] as string,
            calendar,
        );
        vector = shifted.entries;
        for (const entry of vector) {
            if (entry.sessionIndex >= change.sessionIndex) dateOverrides.set(entry.sessionIndex, entry.serviceDate);
        }
    }
    for (const entry of vector) {
        const original = sourceEntries.find((candidate) => candidate.sessionIndex === entry.sessionIndex);
        if (original && entry.serviceDate !== original.serviceDate) dateOverrides.set(entry.sessionIndex, entry.serviceDate);
    }
    for (const [sessionIndex, serviceDate] of dateOverrides) {
        const current = content.get(sessionIndex) ?? { sessionIndex };
        current["serviceDate"] = serviceDate;
        content.set(sessionIndex, current);
    }
    return [...content.values()].sort((left, right) => left.sessionIndex - right.sessionIndex);
}

function mergeHeader(
    previous: ServiceRecordEditJsonValue | undefined,
    incoming: ServiceRecordEditJsonValue | undefined,
): ServiceRecordEditJsonValue | undefined {
    const previousRecord = asRecord(previous);
    const incomingRecord = asRecord(incoming);
    if (!previousRecord && !incomingRecord) return undefined;
    return { ...(previousRecord ?? {}), ...(incomingRecord ?? {}) } as ServiceRecordEditJsonObject;
}

/** Merge a PATCH onto the durable draft and normalize any date move once. */
export function normalizeServiceRecordEditChanges(
    source: ServiceRecordEditSource,
    previousValue: ServiceRecordEditJsonValue | undefined,
    incomingValue: ServiceRecordEditJsonValue,
    calendar: KrBusinessDayCalendar,
    dateMove?: ServiceRecordEditDateMove,
): DraftNormalizationResult {
    const previous = asRecord(previousValue) ?? {};
    const incoming = asRecord(incomingValue) ?? {};
    const previousSessions = sessionChanges(previous["sessions"]);
    const incomingSessions = sessionChanges(incoming["sessions"]);
    const hasDateSnapshot = [...previousSessions, ...incomingSessions].some((session) => typeof session["serviceDate"] === "string");
    const output: ServiceRecordEditJsonObject = {};
    const header = mergeHeader(previous["header"], incoming["header"]);
    if (header !== undefined) output["header"] = header;
    if (!dateMove && !hasDateSnapshot) {
        const merged = mergedContentChanges(previousSessions, incomingSessions);
        if (merged.size > 0) {
            const sessionValues: DraftSessionChange[] = [];
            for (const value of merged.values()) {
                const sessionIndex = numberValue(value["sessionIndex"]);
                if (sessionIndex !== null) sessionValues.push({ ...value, sessionIndex });
            }
            output["sessions"] = sessionValues.sort((left, right) => left.sessionIndex - right.sessionIndex);
        }
        return { changes: output, entries: null };
    }

    const projection = resolveServiceRecordScheduleProjection(source, calendar);
    if (projection.blockingReasons.length > 0) {
        throw new ServiceRecordScheduleValidationError(
            projection.blockingReasons[0]!.code,
            projection.blockingReasons[0]!.message,
            projection.blockingReasons[0]!.sessionIndex ?? null,
        );
    }
    const current = currentDateOverrides(projection.entries, previousSessions);
    const incomingDateOverrides = new Map(incomingSessions
        .filter((change) => typeof change["serviceDate"] === "string")
        .map((change) => [change.sessionIndex, change["serviceDate"] as string]));
    if (!dateMove) {
        for (const [sessionIndex, serviceDate] of incomingDateOverrides) {
            const currentEntry = current.find((entry) => entry.sessionIndex === sessionIndex);
            if (currentEntry && currentEntry.serviceDate !== serviceDate) {
                throw new ServiceRecordScheduleValidationError(
                    "DATE_MOVE_REQUIRED",
                    "서비스 회차 날짜 변경은 dateMove 작업으로 요청해야 합니다.",
                    sessionIndex,
                );
            }
        }
    }
    let sessions = normalizedSessionChanges(projection.entries, previousSessions, dateMove ? [] : incomingSessions, calendar);
    if (dateMove) {
        const shifted = moveServiceRecordSessionDate(
            current,
            dateMove.sessionIndex,
            dateMove.toDate,
            dateMove.shiftFollowing ?? true,
            calendar,
        );
        const content = mergedContentChanges(previousSessions, incomingSessions);
        const normalizedByIndex = new Map<number, DraftSessionChange>();
        const previousDateIndexes = new Set(previousSessions
            .filter((change) => typeof change["serviceDate"] === "string")
            .map((change) => change.sessionIndex));
        for (const value of content.values()) {
            const sessionIndex = numberValue(value["sessionIndex"]);
            if (sessionIndex !== null) normalizedByIndex.set(sessionIndex, { ...value, sessionIndex });
        }
        for (const entry of shifted.entries) {
            const sourceEntry = projection.entries.find((candidate) => candidate.sessionIndex === entry.sessionIndex);
            if (
                entry.sessionIndex >= dateMove.sessionIndex
                || previousDateIndexes.has(entry.sessionIndex)
                || sourceEntry?.serviceDate !== entry.serviceDate
            ) {
                const currentEntry = normalizedByIndex.get(entry.sessionIndex) ?? { sessionIndex: entry.sessionIndex };
                currentEntry["serviceDate"] = entry.serviceDate;
                normalizedByIndex.set(entry.sessionIndex, currentEntry);
            }
        }
        sessions = [...normalizedByIndex.values()].sort((left, right) => left.sessionIndex - right.sessionIndex);
    }
    if (sessions.length > 0) output["sessions"] = sessions;
    return {
        changes: output,
        entries: sessions.length > 0 ? currentDateOverrides(projection.entries, sessions) : projection.entries,
    };
}

function stableValue(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function vectorDates(
    entries: SharedPlannedSession[],
): ServiceRecordEditPreviewVector {
    return {
        startDate: entries[0]?.serviceDate ?? null,
        endDate: entries.at(-1)?.serviceDate ?? null,
        sessions: entries.map((entry) => entry as ServiceRecordPlannedSession),
    };
}

function signatureMetadataForPreview(
    source: ServiceRecordEditSource,
    blockingReasons: ServiceRecordEditPreviewBlockingReason[],
): ServiceRecordEditSignatureMetadata {
    const stored = source.signatureMetadata;
    if (stored) {
        return {
            treatment: blockingReasons.length > 0 || stored.evidence === "unverified"
                ? "manual_review"
                : stored.treatment,
            evidence: stored.evidence,
            sessions: [...stored.sessions].sort((left, right) => left.sessionIndex - right.sessionIndex),
        };
    }

    return {
        treatment: blockingReasons.length > 0 ? "manual_review" : "preserve_existing",
        evidence: "observed",
        sessions: source.sessions
            .map((session) => ({
                sessionIndex: session.sessionIndex,
                hasSignature: Boolean(session.clientSignature),
                signedAt: session.clientSignedAt,
                submittedAt: session.submittedAt,
            }))
            .sort((left, right) => left.sessionIndex - right.sessionIndex),
    };
}

function documentScopeForPreview(source: ServiceRecordEditSource): ServiceRecordEditDocumentScope {
    if (source.documentScope) return source.documentScope;
    return {
        evidence: "unverified",
        serviceRecordSnapshot: {
            documentIds: [],
            snapshotVersion: null,
            chunks: [],
        },
        currentRevision: {
            id: null,
            revisionNumber: null,
            formVersion: null,
        },
        form: {
            version: source.formVersion,
        },
        contract: {
            currentDocumentId: null,
            stage: null,
        },
    };
}

function previewRanges(entries: SharedPlannedSession[]): ServiceRecordEditPreviewAssignmentRange[] {
    const byAssignment = new Map<string, SharedPlannedSession[]>();
    for (const entry of entries) {
        const rows = byAssignment.get(entry.assignmentId) ?? [];
        rows.push(entry);
        byAssignment.set(entry.assignmentId, rows);
    }
    return [...byAssignment.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([assignmentId, rows]) => ({
        assignmentId,
        scheduleId: rows[0]!.scheduleId,
        employeeId: rows[0]!.employeeId,
        startDate: rows[0]!.serviceDate,
        endDate: rows.at(-1)!.serviceDate,
        provenanceVersion: rows[0]!.provenanceVersion,
    }));
}

function applyStoredDates(
    entries: SharedPlannedSession[],
    changes: DraftSessionChange[],
): SharedPlannedSession[] {
    return currentDateOverrides(entries, changes);
}

function contentChanges(
    source: ServiceRecordEditSource,
    before: SharedPlannedSession[],
    after: SharedPlannedSession[],
    changes: DraftSessionChange[],
): ServiceRecordEditPreviewContentChanges {
    const sourceByIndex = new Map(source.sessions.map((session) => [session.sessionIndex, session]));
    const changedSessionIndexes = new Set<number>();
    for (const change of changes) {
        const sourceSession = sourceByIndex.get(change.sessionIndex);
        for (const [key, value] of Object.entries(change)) {
            if (key === "sessionIndex" || key === "serviceDate") continue;
            const sourceValue = sourceSession
                ? sourceSession[key as keyof ServiceRecordEditSourceDay]
                : undefined;
            if (stableValue(sourceValue) !== stableValue(value)) {
                changedSessionIndexes.add(change.sessionIndex);
                break;
            }
        }
    }
    for (const entry of after) {
        // The source day table is sparse: future/unwritten sessions have no
        // row yet. Compare against the canonical before vector so those slots
        // still appear in a preview when a suffix move changes them.
        const original = before.find((candidate) => candidate.sessionIndex === entry.sessionIndex)?.serviceDate;
        if (original !== undefined && original !== entry.serviceDate) changedSessionIndexes.add(entry.sessionIndex);
    }
    return {
        headerChanged: false,
        changedSessionIndexes: [...changedSessionIndexes].sort((left, right) => left - right),
    };
}

/** Build a read-only server preview; it never writes a case, day, client, or assignment. */
export function buildServiceRecordEditPreview(
    input: ServiceRecordEditPreviewBuildInput,
): ServiceRecordEditPreviewResponse {
    const projection = resolveServiceRecordScheduleProjection(input.source, input.calendar);
    const blockingReasons = [...projection.blockingReasons];
    const sourceChanges = asRecord(input.changes) ?? {};
    const draftSessions = sessionChanges(sourceChanges["sessions"]);
    let before = projection.entries;
    let after = projection.entries;
    if (blockingReasons.length === 0) {
        try {
            before = validateServiceRecordScheduleVector(
                projection.entries,
                input.source.requiredSessionCount ?? undefined,
                input.calendar,
                { persisted: true },
            );
            after = applyStoredDates(before, draftSessions);
            after = validateServiceRecordScheduleVector(after, input.source.requiredSessionCount ?? undefined, input.calendar, { persisted: true });
            blockingReasons.push(...assignmentRangeReasons(input.source, after));
        } catch (error) {
            blockingReasons.push(reasonFromError(error));
            before = [];
            after = [];
        }
    }
    const header = asRecord(sourceChanges["header"]);
    const content = contentChanges(input.source, before, after, draftSessions);
    content.headerChanged = Boolean(header && Object.entries(header).some(([key, value]) => {
        const sourceValue = input.source.header[key as keyof ServiceRecordEditSource["header"]];
        return stableValue(sourceValue) !== stableValue(value);
    }));
    const impactedAssignments = new Set<string>();
    for (const entry of after) {
        const original = before.find((candidate) => candidate.sessionIndex === entry.sessionIndex);
        if (original && original.serviceDate !== entry.serviceDate) impactedAssignments.add(entry.assignmentId);
    }
    for (const index of content.changedSessionIndexes) {
        const entry = after.find((candidate) => candidate.sessionIndex === index);
        if (entry) impactedAssignments.add(entry.assignmentId);
    }
    const impactedAssignmentIds = [...impactedAssignments].sort();
    const impactedAssignmentDetails = impactedAssignmentIds.map((assignmentId) => {
        const assignment = assignmentById(input.source, assignmentId);
        return {
            assignmentId,
            employeeName: assignment?.employeeName ?? null,
            startDate: assignment ? (assignment.startDate || assignment.scheduleStartDate || null) : null,
            endDate: assignment ? (assignment.endDate || assignment.scheduleEndDate || null) : null,
        };
    });
    return {
        previewId: input.previewId,
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        sourceCaseVersion: input.sourceCaseVersion,
        sourceFingerprint: input.sourceFingerprint,
        requiredSessionCount: input.source.requiredSessionCount,
        calendarVersion: input.calendar.version,
        before: vectorDates(before),
        after: vectorDates(after),
        provenance: previewRanges(after),
        contentChanges: content,
        impactedAssignments: impactedAssignmentIds,
        impactedAssignmentDetails,
        blockingReasons,
        signatureMetadata: signatureMetadataForPreview(input.source, blockingReasons),
        documentScope: documentScopeForPreview(input.source),
    };
}
