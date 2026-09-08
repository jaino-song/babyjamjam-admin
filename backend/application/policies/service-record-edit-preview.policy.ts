import { KOREAN_HOLIDAY_CALENDAR_VERSION } from "@babyjamjam/shared/utils/business-days";
import {
    getExpectedSessionDateFromRecords,
    ServiceRecordScheduleValidationError,
    type ServiceRecordPlannedSession as SharedPlannedSession,
    validateServiceRecordScheduleVector,
    shiftServiceRecordScheduleSuffix,
} from "@babyjamjam/shared/utils/service-record-schedule";
import type {
    ServiceRecordEditPreviewAssignmentRange,
    ServiceRecordEditPreviewBlockingReason,
    ServiceRecordEditPreviewContentChanges,
    ServiceRecordEditPreviewResponse,
    ServiceRecordEditPreviewVector,
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
}

export interface ServiceRecordEditPreviewBuildInput {
    draftId: string;
    draftVersion: number;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    source: ServiceRecordEditSource;
    changes: ServiceRecordEditJsonValue;
    previewId: string;
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

function assignmentForDate(
    source: ServiceRecordEditSource,
    date: string,
    scheduleId: number | null,
    employeeId: number | null,
): ServiceRecordEditSourceAssignment | null {
    const candidates = source.assignments.filter((assignment) => {
        if (!assignment.id) return false;
        if (scheduleId !== null && assignment.scheduleId !== scheduleId) return false;
        if (employeeId !== null && assignment.employeeId !== null && assignment.employeeId !== employeeId) return false;
        const start = assignment.startDate || assignment.scheduleStartDate;
        const end = assignment.endDate || assignment.scheduleEndDate;
        return Boolean(start && end && date >= start && date <= end);
    });
    return candidates.length === 1 ? candidates[0]! : null;
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

function projectPersisted(source: ServiceRecordEditSource, rawEntries: ServiceRecordEditJsonValue[]): CanonicalProjection {
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
        const validated = validateServiceRecordScheduleVector(entries, expected);
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

function projectLegacy(source: ServiceRecordEditSource): CanonicalProjection {
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
                serviceDate = getExpectedSessionDateFromRecords(source.startDate, sessionIndex, records);
            } catch (error) {
                blockingReasons.push(reasonFromError(error, sessionIndex));
                continue;
            }
            if (!serviceDate) {
                blockingReasons.push(reason("MISSING_PLANNED_DATE", `Session ${sessionIndex} has no planned service date`, sessionIndex));
                continue;
            }
        }
        const assignment = assignmentForDate(source, serviceDate, row?.scheduleId ?? null, row?.employeeId ?? null);
        const entry = sourceAssignmentEntry(source, sessionIndex, serviceDate, serviceDate, assignment, {
            scheduleId: row?.scheduleId,
            employeeId: row?.employeeId,
        });
        if ("code" in entry) blockingReasons.push(entry);
        else entries.push(entry);
    }
    if (blockingReasons.length > 0) return { entries: [], source: "legacy", blockingReasons };
    try {
        const validated = validateServiceRecordScheduleVector(entries, expected);
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
export function resolveServiceRecordScheduleProjection(source: ServiceRecordEditSource): CanonicalProjection {
    const persisted = plannedArray(source);
    if (persisted !== null) return projectPersisted(source, persisted);
    return projectLegacy(source);
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
): DraftSessionChange[] {
    const content = mergedContentChanges(previous, incoming);
    const dateOverrides = new Map<number, string>();
    for (const change of previous) {
        if (typeof change["serviceDate"] === "string") dateOverrides.set(change.sessionIndex, change["serviceDate"] as string);
    }
    let vector = currentDateOverrides(sourceEntries, previous);
    for (const change of incoming) {
        if (typeof change["serviceDate"] !== "string") continue;
        const shifted = shiftServiceRecordScheduleSuffix(vector, change.sessionIndex, change["serviceDate"] as string);
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

    const projection = resolveServiceRecordScheduleProjection(source);
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
    let sessions = normalizedSessionChanges(projection.entries, previousSessions, dateMove ? [] : incomingSessions);
    if (dateMove) {
        const shifted = shiftServiceRecordScheduleSuffix(current, dateMove.sessionIndex, dateMove.toDate);
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
    const projection = resolveServiceRecordScheduleProjection(input.source);
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
            );
            after = applyStoredDates(before, draftSessions);
            after = validateServiceRecordScheduleVector(after, input.source.requiredSessionCount ?? undefined);
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
    return {
        previewId: input.previewId,
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        sourceCaseVersion: input.sourceCaseVersion,
        sourceFingerprint: input.sourceFingerprint,
        requiredSessionCount: input.source.requiredSessionCount,
        calendarVersion: KOREAN_HOLIDAY_CALENDAR_VERSION,
        before: vectorDates(before),
        after: vectorDates(after),
        provenance: previewRanges(after),
        contentChanges: content,
        impactedAssignments: [...impactedAssignments].sort(),
        blockingReasons,
    };
}
