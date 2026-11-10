import {
    UnsupportedKoreanHolidayYearError,
    type KrBusinessDayCalendar,
    type ServiceDayPolicy,
} from "@babyjamjam/shared/utils/business-days";
import {
    getExpectedSessionDateFromRecords,
    ServiceRecordScheduleValidationError,
    type ServiceRecordPlannedSession as SharedPlannedSession,
    validateServiceRecordScheduleVector,
    shiftServiceRecordScheduleSuffix,
    moveServiceRecordSessionDate,
    replanServiceRecordScheduleFromResume,
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

import { IMMUTABLE_FINALIZATION_STATUSES } from "application/services/service-record-lifecycle.service";
import { ServiceRecordEditConflictError } from "domain/errors/service-record-edit.error";
import type {
    ServiceRecordEditConfirmAssignmentUpdate,
    ServiceRecordEditJsonObject,
    ServiceRecordEditJsonValue,
    ServiceRecordEditSource,
    ServiceRecordEditSourceAssignment,
    ServiceRecordEditSourceDay,
} from "domain/repositories/service-record-edit.repository.interface";

import {
    classifyPeriodOwnership,
    isSupersededAssignment,
    scheduleFollows,
    storedAssignmentPeriod,
    type PeriodOwnershipAssignment,
    type PeriodOwnershipPeriod,
    type PeriodOwnershipSource,
} from "./service-record-period-ownership.policy";

export { ServiceRecordScheduleValidationError } from "@babyjamjam/shared/utils/service-record-schedule";

/** Only observed fields used by persisted/legacy schedule projection. */
export type ServiceRecordScheduleProjectionSource = Pick<ServiceRecordEditSource,
    "caseId" | "caseVersion" | "requiredSessionCount" | "startDate" | "endDate"
    | "plannedSessions" | "assignments" | "client"> & {
    sessions: Array<Pick<ServiceRecordEditSourceDay,
        "sessionIndex" | "serviceDate" | "scheduleId" | "employeeId" | "ambiguous">>;
};

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

/** A whole-set schedule replacement, already shape-validated by the service. */
export interface ServiceRecordEditScheduleReplacement {
    serviceDays: ServiceDayPolicy;
    dates: string[];
}

/**
 * Resume replan: the remaining sessions move to consecutive business days from
 * the resume date. Server-produced marker stored in the draft's `changes`.
 */
export interface ServiceRecordEditResumeReplan {
    fromSessionIndex: number;
    resumeDate: string;
    outgoingLastServedDate?: string;
    /** The caregiver who takes the re-planned sessions over; resolved by the policy when absent. */
    incomingAssignmentId?: string;
}

export interface ServiceRecordEditResumeCandidate {
    assignmentId: string;
    employeeName: string | null;
}

/**
 * A resume replan whose incoming caregiver is invalid or cannot be chosen
 * without asking. `candidates` lets the caller (the chat agent) ask the
 * operator and retry with an explicit `incomingAssignmentId`.
 */
export class ServiceRecordResumeAssignmentError extends ServiceRecordScheduleValidationError {
    readonly candidates: ServiceRecordEditResumeCandidate[];

    constructor(
        code: "INCOMING_ASSIGNMENT_INVALID" | "INCOMING_ASSIGNMENT_REQUIRED",
        message: string,
        sessionIndex: number | null,
        candidates: ServiceRecordEditResumeCandidate[] = [],
    ) {
        super(code, message, sessionIndex);
        this.name = "ServiceRecordResumeAssignmentError";
        this.candidates = candidates;
    }
}

/**
 * A blocking reason of a stored resume marker. INCOMING_ASSIGNMENT_REQUIRED and
 * INCOMING_ASSIGNMENT_INVALID carry the assignments the caller can choose from;
 * every other reason keeps the shared shape.
 */
export type ServiceRecordEditResumeBlockingReason = ServiceRecordEditPreviewBlockingReason & {
    candidates?: ServiceRecordEditResumeCandidate[];
};

export interface ServiceRecordEditResumeAssignmentPeriod {
    assignmentId: string;
    employeeName: string | null;
    before: { startDate: string; endDate: string };
    after: { startDate: string; endDate: string };
}

/**
 * The preview of a resume-replan draft. The two extra keys exist only for such
 * drafts, so every other preview (and its hash) keeps its shape.
 */
export type ServiceRecordEditPreviewWithResume = Omit<ServiceRecordEditPreviewResponse, "blockingReasons"> & {
    blockingReasons: ServiceRecordEditResumeBlockingReason[];
    warnings?: ServiceRecordEditPreviewBlockingReason[];
    assignmentPeriods?: ServiceRecordEditResumeAssignmentPeriod[];
};

/** Everything a resume replan derives from the source and the stored marker. */
export interface ServiceRecordEditResumePlan {
    /** The re-planned vector: new dates, and the incoming caregiver as owner of the handed-over sessions. */
    entries: SharedPlannedSession[];
    endDate: string;
    /** The assignment that takes the re-planned sessions over, or null when each session keeps its owner. */
    incomingAssignmentId: string | null;
    /** Every stored assignment with its final dates; the confirm writes exactly these. */
    assignmentWrites: ServiceRecordEditConfirmAssignmentUpdate[];
    assignmentPeriods: ServiceRecordEditResumeAssignmentPeriod[];
}

export interface ServiceRecordEditPreviewBuildInput {
    draftId: string;
    draftVersion: number;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    source: ServiceRecordEditSource;
    changes: ServiceRecordEditJsonValue;
    previewId: string;
    /**
     * The branch calendar WITHOUT any client service-day policy. The policy is
     * applied here: the client's stored toggles shape the "before" projection and
     * the toggles pending in the draft shape every schedule check and the
     * `calendarVersion` (so the preview id is bound to the toggles).
     */
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

/** The client's stored service-day toggles (a missing flag means "not offered"). */
export function storedServiceDays(source: ServiceRecordScheduleProjectionSource): ServiceDayPolicy {
    return {
        saturday: source.client.allowSaturdayService ?? false,
        sunday: source.client.allowSundayService ?? false,
        holiday: source.client.allowHolidayService ?? false,
    };
}

/**
 * The toggles a schedule replacement stored in the draft, or null. `serviceDays`
 * is server-produced only, so anything but three booleans reads as absent.
 */
export function draftServiceDays(changes: ServiceRecordEditJsonValue | undefined): ServiceDayPolicy | null {
    const record = asRecord(asRecord(changes)?.["serviceDays"]);
    if (!record) return null;
    const { saturday, sunday, holiday } = record;
    if (typeof saturday !== "boolean" || typeof sunday !== "boolean" || typeof holiday !== "boolean") return null;
    return { saturday, sunday, holiday };
}

/** Precedence: toggles pending in the draft, then the client's stored toggles. */
export function pendingServiceDays(
    source: ServiceRecordEditSource,
    changes: ServiceRecordEditJsonValue | undefined,
): ServiceDayPolicy {
    return draftServiceDays(changes) ?? storedServiceDays(source);
}

export function sameServiceDays(left: ServiceDayPolicy, right: ServiceDayPolicy): boolean {
    return left.saturday === right.saturday && left.sunday === right.sunday && left.holiday === right.holiday;
}

/**
 * The resume replan a draft stores, or null. The marker is server-produced
 * only, so anything malformed reads as absent.
 */
export function draftResumeReplan(changes: ServiceRecordEditJsonValue | undefined): ServiceRecordEditResumeReplan | null {
    const record = asRecord(asRecord(changes)?.["resumeReplan"]);
    if (!record) return null;
    const fromSessionIndex = numberValue(record["fromSessionIndex"]);
    const resumeDate = stringValue(record["resumeDate"]);
    if (fromSessionIndex === null || fromSessionIndex < 1 || resumeDate === null) return null;
    const outgoing = record["outgoingLastServedDate"];
    const outgoingLastServedDate = outgoing === undefined ? undefined : stringValue(outgoing);
    const incoming = record["incomingAssignmentId"];
    const incomingAssignmentId = incoming === undefined ? undefined : stringValue(incoming);
    if (outgoingLastServedDate === null || incomingAssignmentId === null) return null;
    return {
        fromSessionIndex,
        resumeDate,
        ...(outgoingLastServedDate === undefined ? {} : { outgoingLastServedDate }),
        ...(incomingAssignmentId === undefined ? {} : { incomingAssignmentId }),
    };
}

function resumeMarkerJson(marker: ServiceRecordEditResumeReplan): ServiceRecordEditJsonObject {
    return {
        fromSessionIndex: marker.fromSessionIndex,
        resumeDate: marker.resumeDate,
        ...(marker.outgoingLastServedDate === undefined ? {} : { outgoingLastServedDate: marker.outgoingLastServedDate }),
        ...(marker.incomingAssignmentId === undefined ? {} : { incomingAssignmentId: marker.incomingAssignmentId }),
    };
}

function assignmentById(source: ServiceRecordScheduleProjectionSource, assignmentId: string): ServiceRecordEditSourceAssignment | null {
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
    source: ServiceRecordScheduleProjectionSource,
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
    source: ServiceRecordScheduleProjectionSource,
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

function provenanceVersion(raw: unknown, source: ServiceRecordScheduleProjectionSource): string {
    if (typeof raw === "string" && raw.length > 0) return raw;
    if (typeof raw === "number" && Number.isInteger(raw)) return String(raw);
    return `case-${source.caseVersion}`;
}

function sourceAssignmentEntry(
    source: ServiceRecordScheduleProjectionSource,
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
        && scheduleFollows(writer.scheduleId, planned.scheduleId);
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
    source: ServiceRecordScheduleProjectionSource,
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
    source: ServiceRecordScheduleProjectionSource,
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
    source: ServiceRecordScheduleProjectionSource,
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

type AssignmentPeriod = PeriodOwnershipPeriod;

/** The dates an assignment is judged against: its stored period, or the one a resume replan is about to write. */
type AssignmentPeriodOf = (assignment: PeriodOwnershipAssignment) => AssignmentPeriod | null;

const storedPeriod: AssignmentPeriodOf = storedAssignmentPeriod;

/**
 * Keep each planned slot with its persisted assignment. Moving a suffix may
 * expand an assignment's old interval, but it must not silently hand a slot
 * to another provider; the confirm path derives the new owned range and
 * rejects overlapping assignment ranges. Historical (kept writer) slots take no
 * part in the ranges, and an assignment with only such slots has none (see
 * service-record-period-ownership.policy).
 */
function assignmentRangeReasons(
    source: ServiceRecordScheduleProjectionSource,
    entries: SharedPlannedSession[],
    periodOf: AssignmentPeriodOf = storedPeriod,
): ServiceRecordEditPreviewBlockingReason[] {
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    const byAssignment = new Map<string, SharedPlannedSession[]>();
    for (const entry of entries) {
        const rows = byAssignment.get(entry.assignmentId) ?? [];
        rows.push(entry);
        byAssignment.set(entry.assignmentId, rows);
    }

    const ownership = classifyPeriodOwnership(source, entries, periodOf);
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
        const period = ownership.periodSlots.get(assignmentId);
        if (!period) continue;
        ranges.push({ assignmentId, startDate: period.startDate, endDate: period.endDate });
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

function plannedArray(source: ServiceRecordScheduleProjectionSource): ServiceRecordEditJsonValue[] | null {
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
    source: ServiceRecordScheduleProjectionSource,
    rawEntries: ServiceRecordEditJsonValue[],
    calendar: KrBusinessDayCalendar,
): CanonicalProjection {
    const expected = source.requiredSessionCount;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected <= 0) {
        return {
            entries: [],
            source: "planned",
            blockingReasons: [reason("INVALID_SESSION_COUNT", "서비스 제공 회차 수가 설정되지 않았습니다.")],
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

function projectLegacy(source: ServiceRecordScheduleProjectionSource, calendar: KrBusinessDayCalendar): CanonicalProjection {
    const expected = source.requiredSessionCount;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected <= 0) {
        return {
            entries: [],
            source: "legacy",
            blockingReasons: [reason("INVALID_SESSION_COUNT", "서비스 제공 회차 수가 설정되지 않았습니다.")],
        };
    }
    const blockingReasons: ServiceRecordEditPreviewBlockingReason[] = [];
    const byIndex = new Map<number, ServiceRecordScheduleProjectionSource["sessions"]>();
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
    source: ServiceRecordScheduleProjectionSource,
    calendar: KrBusinessDayCalendar,
): CanonicalProjection {
    const persisted = plannedArray(source);
    if (persisted !== null) return projectPersisted(source, persisted, calendar);
    return projectLegacy(source, calendar);
}

export const CAREGIVER_DATE_WINDOW_DAYS = 7;

function isOutsideCaregiverDateWindow(source: ServiceRecordEditSource, serviceDate: string): boolean {
    if (!source.startDate || !source.endDate) return false;
    const offset = (date: string, days: number): string => {
        const copy = new Date(`${date}T00:00:00.000Z`);
        copy.setUTCDate(copy.getUTCDate() + days);
        return copy.toISOString().slice(0, 10);
    };
    return serviceDate < offset(source.startDate, -CAREGIVER_DATE_WINDOW_DAYS)
        || serviceDate > offset(source.endDate, CAREGIVER_DATE_WINDOW_DAYS);
}

/** 작성된 기록의 날짜 수정만 제공인력과 같은 기간·서비스일 조건으로 판단해요. */
function writtenDateCorrectionReasons(
    source: ServiceRecordEditSource,
    before: SharedPlannedSession[],
    after: SharedPlannedSession[],
    calendar: KrBusinessDayCalendar,
): ServiceRecordEditPreviewBlockingReason[] {
    const writtenIndexes = new Set(source.sessions
        .filter((session) => session.locked || session.submittedAt)
        .map((session) => session.sessionIndex));
    const beforeByIndex = new Map(before.map((entry) => [entry.sessionIndex, entry.serviceDate]));
    const reasons: ServiceRecordEditPreviewBlockingReason[] = [];
    for (const entry of after) {
        if (!writtenIndexes.has(entry.sessionIndex) || beforeByIndex.get(entry.sessionIndex) === entry.serviceDate) continue;
        if (isOutsideCaregiverDateWindow(source, entry.serviceDate)) {
            reasons.push(reason("SERVICE_DATE_OUT_OF_RANGE", "고를 수 있는 기간이 아니에요.", entry.sessionIndex, entry.assignmentId));
        }
        if (!calendar.isBusinessDay(entry.serviceDate)) {
            reasons.push(reason("NON_SERVICE_DAY", "서비스를 하지 않는 날이에요.", entry.sessionIndex, entry.assignmentId));
        }
    }
    return reasons;
}

/**
 * A schedule replacement leaves the date of a session the caregiver already
 * locked or submitted alone: the record exists and was signed against that
 * date. Applies to schedule drafts only; a single-session dateMove may still
 * move a locked session.
 */
function lockedSessionReasons(
    source: ServiceRecordEditSource,
    before: SharedPlannedSession[],
    after: SharedPlannedSession[],
): ServiceRecordEditPreviewBlockingReason[] {
    const beforeByIndex = new Map(before.map((entry) => [entry.sessionIndex, entry]));
    const afterByIndex = new Map(after.map((entry) => [entry.sessionIndex, entry]));
    const lockedIndexes = [...new Set(source.sessions
        .filter((session) => session.locked || Boolean(session.submittedAt))
        .map((session) => session.sessionIndex))]
        .sort((left, right) => left - right);
    const reasons: ServiceRecordEditPreviewBlockingReason[] = [];
    for (const sessionIndex of lockedIndexes) {
        const previous = beforeByIndex.get(sessionIndex);
        const next = afterByIndex.get(sessionIndex);
        if (previous && next && previous.serviceDate !== next.serviceDate) {
            reasons.push(reason(
                "LOCKED_SESSION_DATE_CHANGED",
                `Session ${sessionIndex} is locked or submitted, so its service date cannot change`,
                sessionIndex,
                next.assignmentId,
            ));
        }
    }
    return reasons;
}

/** Earliest date a service may be scheduled on: the case and client start dates, whichever is earlier. */
function scheduleStartBound(source: ServiceRecordEditSource): string | null {
    const bounds = [source.startDate, source.client.startDate].filter((value): value is string => Boolean(value));
    return bounds.length === 0 ? null : bounds.sort()[0]!;
}

/**
 * Checks specific to a schedule replacement. Locked sessions (reported
 * separately) are never judged, and neither is an unchanged date up to the
 * latest locked session's stored date, so written history that predates the
 * client's toggles stays valid. Every other date, changed or not, is checked
 * against the pending policy.
 * `calendar` must carry the PENDING toggles. May throw
 * `UnsupportedKoreanHolidayYearError` for a date in an unpopulated year.
 */
function scheduleReplacementReasons(
    source: ServiceRecordEditSource,
    before: SharedPlannedSession[],
    after: SharedPlannedSession[],
    calendar: KrBusinessDayCalendar,
): ServiceRecordEditPreviewBlockingReason[] {
    const beforeByIndex = new Map(before.map((entry) => [entry.sessionIndex, entry]));
    const lockedIndexes = new Set(source.sessions
        .filter((session) => session.locked || Boolean(session.submittedAt))
        .map((session) => session.sessionIndex));
    // Written (locked/submitted) sessions fix the schedule up to their latest stored date:
    // an unchanged date inside that region keeps its history, everything else is judged.
    let fixedUntil: string | null = null;
    for (const entry of before) {
        if (lockedIndexes.has(entry.sessionIndex) && (fixedUntil === null || entry.serviceDate > fixedUntil)) {
            fixedUntil = entry.serviceDate;
        }
    }
    const start = scheduleStartBound(source);
    const reasons: ServiceRecordEditPreviewBlockingReason[] = [];
    for (const entry of after) {
        const previous = beforeByIndex.get(entry.sessionIndex);
        if (!previous || lockedIndexes.has(entry.sessionIndex)) continue;
        if (previous.serviceDate === entry.serviceDate && fixedUntil !== null && entry.serviceDate <= fixedUntil) continue;
        if (start && entry.serviceDate < start) {
            reasons.push(reason(
                "SCHEDULE_BEFORE_START",
                `Session ${entry.sessionIndex} is dated ${entry.serviceDate}, before the service start ${start}`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
        if (!calendar.isBusinessDay(entry.serviceDate)) {
            reasons.push(reason(
                "NON_SERVICE_DAY",
                `Session ${entry.sessionIndex} is dated ${entry.serviceDate}, which is not a service day for this client`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
    }
    return reasons;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isRealIsoDate(value: string): boolean {
    if (!ISO_DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function kstDateOf(timestamp: string): string | null {
    const millis = Date.parse(timestamp);
    return Number.isNaN(millis) ? null : new Date(millis + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const isSuperseded = isSupersededAssignment;

function usableAssignment(assignment: ServiceRecordEditSourceAssignment): boolean {
    return Boolean(assignment.id) && assignment.scheduleId !== null && assignment.employeeId !== null;
}

function toCandidates(assignments: ServiceRecordEditSourceAssignment[]): ServiceRecordEditResumeCandidate[] {
    return assignments.map((assignment) => ({ assignmentId: assignment.id!, employeeName: assignment.employeeName }));
}

function describeCandidates(candidates: ServiceRecordEditResumeCandidate[]): string {
    return candidates
        .map((candidate) => `${candidate.assignmentId}${candidate.employeeName ? ` (${candidate.employeeName})` : ""}`)
        .join(", ");
}

function liveAssignments(
    source: ServiceRecordEditSource,
    except: ServiceRecordEditSourceAssignment | null,
): ServiceRecordEditSourceAssignment[] {
    return source.assignments.filter((assignment) =>
        assignment !== except && usableAssignment(assignment) && !isSuperseded(assignment));
}

/**
 * The live (not replaced, not terminated) assignment that took over from the
 * superseded `from` assignment. A successor is a live assignment of the case
 * whose schedule came after `from`'s (the greater schedule id: the same order
 * the token service and the finalization match use), never one picked by stored
 * dates, which may overlap or sit before `from`'s own (a caregiver replaced
 * before her start is stored as [start, start]). Every live assignment that
 * came after `from` is a successor, so replacements need no walk along a chain
 * and nothing can cycle. Exactly one successor is the answer; several need the
 * caller to choose, and none (also when `from` has no schedule) lists every live
 * assignment. Both rejections name the candidates.
 */
function resolveLiveSuccessor(
    source: ServiceRecordEditSource,
    from: ServiceRecordEditSourceAssignment,
    fromSessionIndex: number,
): ServiceRecordEditSourceAssignment {
    const live = liveAssignments(source, from);
    const successors = live.filter((assignment) => scheduleFollows(assignment.scheduleId, from.scheduleId));
    if (successors.length === 1) return successors[0]!;
    const candidates = toCandidates(successors.length > 0 ? successors : live);
    const noCaregiver = successors.length === 0;
    const choose = candidates.length > 0 ? `choose the incoming one from: ${describeCandidates(candidates)}` : "assign a caregiver first";
    throw new ServiceRecordResumeAssignmentError(
        "INCOMING_ASSIGNMENT_REQUIRED",
        noCaregiver
            ? `No active caregiver could be found after assignment ${from.id}; ${choose}`
            : `More than one caregiver follows assignment ${from.id}; ${choose}`,
        fromSessionIndex,
        candidates,
    );
}

/**
 * The sessions a resume replan reasons about: the last kept session the
 * outgoing caregiver actually served, and the sessions that decide who takes
 * over. A historical (kept writer) slot, judged against the stored periods, is
 * neither: it is a leftover row of a caregiver whose period no longer reaches
 * it, so it says nothing about who served last or who is next, and it never
 * moves a boundary. There is no fallback to such a slot: when every kept
 * session before the resumed one is historical there is no outgoing caregiver
 * (the resume reads like one from session 1), and when every remaining session
 * is, no remaining owner decides. Before any handover there is no historical
 * slot, so nothing changes there.
 *
 * `planned` are the REPLANNED sessions (the dates the resume is about to write,
 * before any handover; the replan never depends on the incoming caregiver), each
 * judged against the STORED assignment periods: a session that only becomes
 * historical because the replan moved it outside its owner's period is no anchor.
 */
function resumeAnchors(
    source: ServiceRecordEditSource,
    planned: SharedPlannedSession[],
    fromSessionIndex: number,
): { outgoing: SharedPlannedSession | null; remaining: SharedPlannedSession[] } {
    const { historicalSlots } = classifyPeriodOwnership(source, planned);
    const kept = planned.slice(0, fromSessionIndex - 1);
    const remaining = planned.slice(fromSessionIndex - 1);
    const lastServed = [...kept].reverse().find((entry) => !historicalSlots.has(entry.sessionIndex)) ?? null;
    return { outgoing: lastServed, remaining: remaining.filter((entry) => !historicalSlots.has(entry.sessionIndex)) };
}

/**
 * Who takes the re-planned sessions (index >= fromSessionIndex) over.
 * Returns null when the sessions keep the owners the vector already gives them
 * (only with no period-bearing outgoing caregiver: from session 1, or after an
 * all-historical kept prefix; and only for an authoritative split: a persisted
 * vector whose every owner in the split is live).
 *
 * 1. An explicit `incomingAssignmentId` must be a live (not replaced, not
 *    terminated) assignment of this case other than the outgoing one.
 * 2. When the vector hands the remaining sessions to one other caregiver than
 *    the one who served the last kept session, that caregiver is it, unless
 *    it was itself replaced or terminated: then its live successor is.
 * 3. Otherwise look at the caregiver X of the last kept session that was not a
 *    historical writer slot (the first session when there is none, as when
 *    re-planning from the start). A replaced or terminated X has been succeeded:
 *    exactly one live successor takes over, several or none need the caller to
 *    choose. A live X that owns every remaining session is a plain pause. Any
 *    other split has no single answer and is never settled by date coverage.
 *    The remaining sessions that decide are the ones bearing a period: when every
 *    one is a historical slot no remaining owner decides, so a live X has no
 *    answer either and the caller has to choose among the other live assignments.
 */
function resolveResumeIncoming(
    source: ServiceRecordEditSource,
    planned: SharedPlannedSession[],
    marker: ServiceRecordEditResumeReplan,
): ServiceRecordEditSourceAssignment | null {
    const { fromSessionIndex, incomingAssignmentId } = marker;
    const anchors = resumeAnchors(source, planned, fromSessionIndex);
    const outgoingId = anchors.outgoing?.assignmentId ?? null;
    const remainingOwnerIds = [...new Set(anchors.remaining.map((entry) => entry.assignmentId))];
    const ownerOf = (assignmentId: string): ServiceRecordEditSourceAssignment => {
        const assignment = assignmentById(source, assignmentId);
        if (!assignment || !usableAssignment(assignment)) {
            throw new ServiceRecordScheduleValidationError(
                "MISSING_ASSIGNMENT_PROVENANCE",
                `Assignment ${assignmentId} has no schedule or employee to take the sessions over`,
                fromSessionIndex,
            );
        }
        return assignment;
    };
    const invalid = (message: string) => new ServiceRecordResumeAssignmentError(
        "INCOMING_ASSIGNMENT_INVALID",
        message,
        fromSessionIndex,
    );

    if (incomingAssignmentId !== undefined) {
        const assignment = assignmentById(source, incomingAssignmentId);
        if (!assignment) throw invalid(`Assignment ${incomingAssignmentId} is not an assignment of this service record`);
        if (assignment.id === outgoingId) throw invalid(`Assignment ${incomingAssignmentId} is the outgoing assignment`);
        if (isSuperseded(assignment)) {
            throw invalid(`Assignment ${incomingAssignmentId} was replaced or terminated and cannot take sessions over`);
        }
        if (!usableAssignment(assignment)) {
            throw invalid(`Assignment ${incomingAssignmentId} has no schedule or employee to take the sessions over`);
        }
        return assignment;
    }

    if (fromSessionIndex > 1 && remainingOwnerIds.length === 1 && remainingOwnerIds[0] !== outgoingId) {
        const remainingOwner = ownerOf(remainingOwnerIds[0]!);
        return isSuperseded(remainingOwner) ? resolveLiveSuccessor(source, remainingOwner, fromSessionIndex) : remainingOwner;
    }

    // With no period-bearing outgoing caregiver (from session 1, or when the whole kept prefix is
    // historical) a split that is authoritative (persisted, every owner live) is not ambiguous:
    // each caregiver keeps their sessions and only the outer edges move. A projected (legacy)
    // split, or one with a replaced owner, only records who held a date, so it is not trusted.
    if (
        outgoingId === null
        && remainingOwnerIds.length > 1
        && plannedArray(source) !== null
        && remainingOwnerIds.every((assignmentId) => {
            const owner = assignmentById(source, assignmentId);
            return owner !== null && !isSuperseded(owner);
        })
    ) {
        return null;
    }

    const previousOwnerId = outgoingId ?? planned[0]!.assignmentId;
    const previousOwner = assignmentById(source, previousOwnerId);
    if (previousOwner && isSuperseded(previousOwner)) {
        return resolveLiveSuccessor(source, previousOwner, fromSessionIndex);
    }
    if (remainingOwnerIds.length === 0) {
        // Only the outgoing assignment is left out: it cannot be chosen as its own successor.
        const candidates = toCandidates(liveAssignments(source, null).filter((assignment) => assignment.id !== outgoingId));
        const choose = candidates.length > 0 ? `choose the incoming one from: ${describeCandidates(candidates)}` : "assign a caregiver first";
        throw new ServiceRecordResumeAssignmentError(
            "INCOMING_ASSIGNMENT_REQUIRED",
            `No caregiver owns a period in the sessions from ${fromSessionIndex}; ${choose}`,
            fromSessionIndex,
            candidates,
        );
    }
    if (remainingOwnerIds.length === 1) return ownerOf(remainingOwnerIds[0]!);
    const owners = remainingOwnerIds
        .map((assignmentId) => assignmentById(source, assignmentId))
        .filter((assignment): assignment is ServiceRecordEditSourceAssignment => assignment !== null && usableAssignment(assignment));
    const live = owners.filter((assignment) => !isSuperseded(assignment));
    const candidates = toCandidates(live.length > 0 ? live : owners);
    throw new ServiceRecordResumeAssignmentError(
        "INCOMING_ASSIGNMENT_REQUIRED",
        `The sessions from ${fromSessionIndex} belong to more than one caregiver; choose the incoming one from: ${describeCandidates(candidates)}`,
        fromSessionIndex,
        candidates,
    );
}

/**
 * Hand the re-planned sessions over to the incoming caregiver. A session whose
 * day row was written by somebody else keeps its owner: a row is never
 * re-attributed, and a vector that disagreed with its rows would block every
 * later edit and the finalization match. Such a session is reported through the
 * ASSIGNMENT_MISMATCH warning instead.
 */
function handOverSessions(
    source: ServiceRecordEditSource,
    entries: SharedPlannedSession[],
    fromSessionIndex: number,
    incoming: ServiceRecordEditSourceAssignment | null,
): SharedPlannedSession[] {
    if (!incoming) return entries;
    return entries.map((entry) => {
        if (entry.sessionIndex < fromSessionIndex || entry.assignmentId === incoming.id) return entry;
        const rows = source.sessions.filter((session) => session.sessionIndex === entry.sessionIndex);
        const row = rows.length === 1 && !rows[0]!.ambiguous ? rows[0]! : null;
        const writtenByOther = row !== null
            && ((row.scheduleId !== null && row.scheduleId !== incoming.scheduleId)
                || (row.employeeId !== null && row.employeeId !== incoming.employeeId));
        if (writtenByOther || rows.length > 1) return entry;
        return { ...entry, assignmentId: incoming.id!, scheduleId: incoming.scheduleId!, employeeId: incoming.employeeId! };
    });
}

/**
 * Derive everything a resume replan changes from the source projection
 * (`before`, after reattributedBackfill) and the marker. PATCH, preview and
 * confirm all go through this one function, so what is approved is what is
 * written. Throws `ServiceRecordScheduleValidationError` for a request that
 * cannot be applied.
 *
 * Handover: the incoming caregiver (`resolveResumeIncoming`) takes the
 * re-planned sessions over, so a replaced caregiver's assignment is never
 * extended. Assignment boundary: never decided by date coverage (on the
 * handover day both assignments cover the date). The outgoing assignment is the
 * one the projection gives the last kept session before `fromSessionIndex` that
 * is not a historical writer slot. From session 1, or when every session before
 * the resumed one is such a slot, there is no outgoing assignment: without a
 * handover the existing outer-edge rule applies, with one the incoming
 * assignment takes the whole new period, starting with the first session it
 * owns, and the replaced one keeps its stored dates. The outgoing assignment
 * ends with the last session it served, never at a historical writer slot. A
 * historical-only assignment (all its sessions are such slots) is no edge and
 * keeps its stored dates. The incoming caregiver's end is the last session of an
 * owner that bears a period, never a kept writer slot after it. Every other
 * assignment keeps its dates, except that the outer-edge rule every later
 * confirm applies is applied to the written periods (`settleOnResumedPeriods`) until
 * a pass moves nothing, at most one pass per written assignment plus RESUME_SETTLE_SPARE_PASSES.
 * The written periods are then a fixed point of that rule, so a header-only confirm right after
 * moves no period; a resume whose periods do not settle within the bound is blocked
 * (INVALID_ASSIGNMENT_RANGE).
 *
 * `options.maxSettlePasses` replaces the bound and exists for tests only (to pin the refusal);
 * no production caller passes it.
 */
export function planResumeReplan(
    source: ServiceRecordEditSource,
    before: SharedPlannedSession[],
    marker: ServiceRecordEditResumeReplan,
    calendar: KrBusinessDayCalendar,
    options: { maxSettlePasses?: number } = {},
): ServiceRecordEditResumePlan {
    const { fromSessionIndex, resumeDate, outgoingLastServedDate } = marker;
    if (!Number.isInteger(fromSessionIndex) || fromSessionIndex < 1 || fromSessionIndex > before.length) {
        throw new ServiceRecordScheduleValidationError(
            "INVALID_SESSION_INDEX",
            `Session ${fromSessionIndex} is outside the contracted range 1..${before.length}`,
            Number.isInteger(fromSessionIndex) ? fromSessionIndex : null,
        );
    }
    if (!isRealIsoDate(resumeDate) || (outgoingLastServedDate !== undefined && !isRealIsoDate(outgoingLastServedDate))) {
        throw new ServiceRecordScheduleValidationError(
            "INVALID_DATE",
            "The resume date and the outgoing last served date must be real YYYY-MM-DD dates",
            fromSessionIndex,
        );
    }
    // The editor never adjusts the date silently: the user picks a business day.
    if (!calendar.isBusinessDay(resumeDate)) {
        throw new ServiceRecordScheduleValidationError(
            "RESUME_DATE_NOT_BUSINESS_DAY",
            `Resume date ${resumeDate} is not a service day for this client`,
            fromSessionIndex,
        );
    }
    const replanned = replanServiceRecordScheduleFromResume(before, fromSessionIndex, resumeDate, calendar);
    const endDate = replanned.endDate;
    const firstReplanned = replanned.entries[fromSessionIndex - 1]!.serviceDate;
    // Anchors and the incoming caregiver are judged on the replanned dates (the replan does not
    // depend on who takes over), against the stored periods.
    const { outgoing, remaining } = resumeAnchors(source, replanned.entries, fromSessionIndex);
    const outgoingId = outgoing?.assignmentId ?? null;
    const outOfRange = (message: string) => new ServiceRecordScheduleValidationError(
        "OUTGOING_LAST_SERVED_OUT_OF_RANGE",
        message,
        fromSessionIndex,
    );
    const incoming = resolveResumeIncoming(source, replanned.entries, marker);
    const entries = handOverSessions(source, replanned.entries, fromSessionIndex, incoming);
    const owners = new Set(entries.map((entry) => entry.assignmentId));
    // Without a period-bearing remaining owner the incoming caregiver takes the sessions from nobody
    // who covers them, which is still a handover: the replaced owner keeps its stored dates.
    const handover = incoming !== null
        && (remaining.length === 0 || remaining.some((entry) => entry.assignmentId !== incoming.id));
    // The incoming caregiver's write starts on the first session it owns after the handover. That is
    // not always the first re-planned date: a session a row keeps with its writer can come first.
    const incomingStart = incoming === null
        ? firstReplanned
        : entries.find((entry) => entry.sessionIndex >= fromSessionIndex && entry.assignmentId === incoming.id)?.serviceDate
            ?? firstReplanned;

    // The end the incoming caregiver's period takes. `endDate` is the last re-planned date, but when
    // that date is a kept writer slot of a historical-only caregiver it is no period: the next confirm
    // ends the edge on the last session whose owner bears one, so the resume must write that same date.
    // Judged against the stored periods, exactly like the handover. With no later period-bearing
    // session than the incoming start (everything after it is historical) the last date stays.
    const { historicalOnly: edgeHistoricalOnly } = classifyPeriodOwnership(source, entries);
    const edgeEnd = entries.filter((entry) => !edgeHistoricalOnly.has(entry.assignmentId)).at(-1)?.serviceDate ?? endDate;
    const endFrom = (start: string) => (edgeEnd >= start ? edgeEnd : endDate);

    const targeted = new Map<string, { startDate?: string; endDate: string }>();
    if (outgoingId === null) {
        if (outgoingLastServedDate !== undefined) {
            throw outOfRange("The outgoing last served date needs a session before the resumed one that its caregiver served");
        }
        // From the first session a handover moves the whole period to the incoming caregiver.
        // The replaced caregiver keeps its stored dates: there is no kept session to derive an end from.
        if (handover) targeted.set(incoming!.id!, { startDate: incomingStart, endDate: endFrom(incomingStart) });
    } else {
        const incomingId = incoming!.id!;
        // The outgoing caregiver ends with the last session it served; a kept writer slot never widens that.
        const lastKept = outgoing!.serviceDate;
        if (outgoingId === incomingId) {
            if (outgoingLastServedDate !== undefined) {
                throw outOfRange("The outgoing last served date applies only when the caregiver changes");
            }
            targeted.set(incomingId, { endDate: endFrom(firstReplanned) });
        } else {
            if (outgoingLastServedDate !== undefined && (outgoingLastServedDate < lastKept || outgoingLastServedDate >= firstReplanned)) {
                throw outOfRange(
                    `The outgoing last served date must be between ${lastKept} and the day before ${firstReplanned}`,
                );
            }
            targeted.set(outgoingId, { endDate: outgoingLastServedDate ?? lastKept });
            targeted.set(incomingId, { startDate: incomingStart, endDate: endFrom(incomingStart) });
        }
    }

    let writes: ServiceRecordEditConfirmAssignmentUpdate[];
    try {
        // Stored periods judge which sessions are historical: the plan's own writes are not known yet.
        const { historicalOnly } = classifyPeriodOwnership(source, entries);
        if (outgoingId === null && !handover) {
            writes = confirmAssignmentWrites(source, entries);
        } else {
            writes = assignmentWrites(source, null, null, owners, historicalOnly).map((write) => {
                const assignment = write.assignmentId ? assignmentById(source, write.assignmentId) : null;
                const target = write.assignmentId ? targeted.get(write.assignmentId) : undefined;
                // Every assignment but the boundary ones is left exactly as stored.
                if (!assignment || !target) return { ...write, datesChanged: false };
                const startDate = target.startDate ?? write.startDate;
                if (startDate > target.endDate) {
                    throw new ServiceRecordScheduleValidationError(
                        "INVALID_ASSIGNMENT_RANGE",
                        `Assignment ${write.assignmentId} would end on ${target.endDate}, before its start ${startDate}`,
                        fromSessionIndex,
                    );
                }
                return {
                    ...write,
                    startDate,
                    endDate: target.endDate,
                    datesChanged: startDate !== assignment.startDate
                        || startDate !== assignment.scheduleStartDate
                        || target.endDate !== assignment.endDate
                        || target.endDate !== assignment.scheduleEndDate,
                };
            });
            for (const assignmentId of targeted.keys()) {
                if (!writes.some((write) => write.assignmentId === assignmentId)) {
                    throw new ServiceRecordScheduleValidationError(
                        "MISSING_ASSIGNMENT_PROVENANCE",
                        `Assignment ${assignmentId} has no schedule to write`,
                        fromSessionIndex,
                    );
                }
            }
        }
        // The next confirm applies the outer-edge rule to what is stored then. Settle the written periods
        // against that rule until a pass moves nothing: one pass can move a head's start so that the
        // stored order, and with it the tail the next confirm picks, differs from the one it settled on.
        // Only a fixed point is a state the next confirm leaves alone; a plan that does not reach one
        // within the bound fails closed instead of being written.
        const maxSettlePasses = options.maxSettlePasses ?? writes.length + RESUME_SETTLE_SPARE_PASSES;
        let settled = false;
        for (let pass = 0; pass < maxSettlePasses; pass++) {
            const next = settleOnResumedPeriods(source, entries, writes);
            const same = next.every((write, index) => write.startDate === writes[index]!.startDate && write.endDate === writes[index]!.endDate);
            writes = next;
            if (same) {
                settled = true;
                break;
            }
        }
        if (!settled) {
            throw new ServiceRecordScheduleValidationError(
                "INVALID_ASSIGNMENT_RANGE",
                "The resumed assignment periods do not settle: a following edit would move them again",
                fromSessionIndex,
            );
        }
    } catch (error) {
        if (error instanceof ServiceRecordEditConflictError) {
            throw new ServiceRecordScheduleValidationError("INVALID_ASSIGNMENT_RANGE", error.message, fromSessionIndex);
        }
        throw error;
    }

    const assignmentPeriods = writes
        .filter((write) => write.assignmentId !== null && (targeted.has(write.assignmentId) || write.datesChanged))
        .map((write) => {
            const assignment = assignmentById(source, write.assignmentId!);
            return {
                assignmentId: write.assignmentId!,
                employeeName: assignment?.employeeName ?? null,
                before: {
                    startDate: assignment ? (assignment.startDate || assignment.scheduleStartDate) : "",
                    endDate: assignment ? (assignment.endDate || assignment.scheduleEndDate) : "",
                },
                after: { startDate: write.startDate, endDate: write.endDate },
            };
        });
    return { entries, endDate, incomingAssignmentId: incoming?.id ?? null, assignmentWrites: writes, assignmentPeriods };
}

/**
 * Passes allowed beyond one per written assignment. Each pass can collapse one more superseded period
 * onto the resume edge, so the passes a plan needs grow with its assignments (measured: assignments + 1,
 * the last being the pass that moves nothing); a plan still moving after the bound is blocked.
 */
const RESUME_SETTLE_SPARE_PASSES = 2;

/**
 * The writes of a resume once the confirm that follows it is taken into account.
 *
 * A resume moves the boundaries it hands over on purpose; every other owner is left as stored. But the
 * next confirm of the record (any edit) applies the outer-edge rule over the stored periods it then reads:
 * the head and the tail owner follow the first and last planned session whose owner bears a period. A
 * replaced caregiver whose own kept session the replan moved is such an owner. Leaving it as stored would
 * make that confirm move it silently, a write nobody previewed. So the periods the resume writes are run
 * through `confirmAssignmentWrites` as if they were already stored: it moves only what it moves
 * for any confirm, and hands back what was planned otherwise. This is one pass; the caller repeats it
 * until a pass moves nothing. A pass can move a head's start, which re-orders the stored periods and so
 * can change which assignment is the tail, and it can collapse another superseded period onto the resume
 * edge, which the next pass then sees as an edge of its own. `datesChanged` stays relative to the
 * periods stored now: it turns true only when the plan or this settle moved a date.
 */
function settleOnResumedPeriods(
    source: ServiceRecordEditSource,
    entries: readonly SharedPlannedSession[],
    writes: readonly ServiceRecordEditConfirmAssignmentUpdate[],
): ServiceRecordEditConfirmAssignmentUpdate[] {
    const planned = new Map(writes.flatMap((write) => (write.assignmentId !== null ? [[write.assignmentId, write] as const] : [])));
    const resumed = {
        sessions: source.sessions,
        assignments: source.assignments.map((assignment) => {
            const write = assignment.id !== null ? planned.get(assignment.id) : undefined;
            return write
                ? { ...assignment, startDate: write.startDate, endDate: write.endDate, scheduleStartDate: write.startDate, scheduleEndDate: write.endDate }
                : assignment;
        }),
    };
    const settled = new Map(confirmAssignmentWrites(resumed, entries).map((write) => [write.assignmentId, write] as const));
    // The order the plan lists its writes in is the order of the periods stored now: keep it.
    return writes.map((write) => {
        const final = settled.get(write.assignmentId) ?? write;
        // Only a date the settle moved is new; a mismatch between the two tables that the plan itself
        // leaves alone is not this function's to heal.
        const moved = final.startDate !== write.startDate || final.endDate !== write.endDate;
        return { ...final, datesChanged: write.datesChanged || moved };
    });
}

export interface ServiceRecordEditResumeResolution {
    marker: ServiceRecordEditResumeReplan;
    plan: ServiceRecordEditResumePlan | null;
    reasons: ServiceRecordEditResumeBlockingReason[];
}

/**
 * The plan a draft's stored marker yields against the current source and
 * calendar, or null when the draft has no marker. A plan that cannot be built
 * comes back as blocking reasons (never thrown), so the preview and the confirm
 * judge it identically.
 */
export function resolveResumeReplan(
    source: ServiceRecordEditSource,
    changes: ServiceRecordEditJsonValue | undefined,
    calendar: KrBusinessDayCalendar,
): ServiceRecordEditResumeResolution | null {
    const marker = draftResumeReplan(changes);
    if (!marker) return null;
    const pendingCalendar = calendar.withServiceDays(storedServiceDays(source));
    const projection = resolveServiceRecordScheduleProjection(source, pendingCalendar);
    if (projection.blockingReasons.length > 0) return { marker, plan: null, reasons: projection.blockingReasons };
    try {
        return { marker, plan: planResumeReplan(source, projection.entries, marker, pendingCalendar), reasons: [] };
    } catch (error) {
        return {
            marker,
            plan: null,
            reasons: [error instanceof UnsupportedKoreanHolidayYearError
                ? reason("UNSUPPORTED_HOLIDAY_YEAR", error.message)
                : error instanceof ServiceRecordResumeAssignmentError
                    ? { ...reasonFromError(error, marker.fromSessionIndex), candidates: error.candidates }
                    : reasonFromError(error, marker.fromSessionIndex)],
        };
    }
}

/** Carry the planned owners a resume replan hands over into the preview's `after` vector. */
function applyResumeHandover(after: SharedPlannedSession[], planned: SharedPlannedSession[]): SharedPlannedSession[] {
    const plannedByIndex = new Map(planned.map((entry) => [entry.sessionIndex, entry]));
    return after.map((entry) => {
        const target = plannedByIndex.get(entry.sessionIndex);
        return target && target.assignmentId !== entry.assignmentId
            ? { ...entry, assignmentId: target.assignmentId, scheduleId: target.scheduleId, employeeId: target.employeeId }
            : entry;
    });
}

/**
 * Non-blocking observations on the re-planned sessions: a submission that now
 * precedes its service date, and a stored owner that does not own its new date
 * under the new assignment periods.
 */
function resumeReplanWarnings(
    source: ServiceRecordEditSource,
    after: SharedPlannedSession[],
    plan: ServiceRecordEditResumePlan,
    fromSessionIndex: number,
): ServiceRecordEditPreviewBlockingReason[] {
    const periods = new Map(plan.assignmentWrites
        .filter((write) => write.assignmentId !== null)
        .map((write) => [write.assignmentId!, write]));
    const warnings: ServiceRecordEditPreviewBlockingReason[] = [];
    for (const entry of after) {
        if (entry.sessionIndex < fromSessionIndex) continue;
        const rows = source.sessions.filter((session) => session.sessionIndex === entry.sessionIndex && !session.ambiguous);
        const row = rows.length === 1 ? rows[0]! : null;
        const submittedOn = row?.submittedAt ? kstDateOf(row.submittedAt) : null;
        if (submittedOn !== null && submittedOn < entry.serviceDate) {
            warnings.push(reason(
                "SUBMITTED_BEFORE_NEW_DATE",
                `Session ${entry.sessionIndex} was submitted on ${submittedOn}, before its new service date ${entry.serviceDate}`,
                entry.sessionIndex,
                entry.assignmentId,
            ));
        }
        const rowOwners = row && row.scheduleId !== null
            ? source.assignments.filter((assignment) =>
                Boolean(assignment.id)
                && assignment.scheduleId === row.scheduleId
                && (row.employeeId === null || assignment.employeeId === null || assignment.employeeId === row.employeeId))
            : [];
        const ownerId = rowOwners.length === 1 ? rowOwners[0]!.id! : entry.assignmentId;
        const period = periods.get(ownerId);
        if (!period || entry.serviceDate < period.startDate || entry.serviceDate > period.endDate) {
            warnings.push(reason(
                "ASSIGNMENT_MISMATCH",
                `Session ${entry.sessionIndex} belongs to an assignment that does not cover its new service date ${entry.serviceDate}`,
                entry.sessionIndex,
                ownerId,
            ));
        }
    }
    return warnings;
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

/**
 * Dates written to service_record_assignment and employee_schedule on confirm.
 *
 * An assignment period is a record only: it never gates who may write the service
 * record, and a session dated outside every period never blocks the confirm. The
 * confirm keeps that record as accurate as it safely can, so only the two outer
 * edges follow the planned session dates; an inner handover boundary (outgoing
 * end == incoming start) is owned by the caregiver replacement flow, which
 * deliberately stores it that way, so every stored assignment keeps its dates
 * except those two outer edges. The outer edges follow the assignments, not who
 * wrote the sessions: an unwritten service record does not mean the caregiver did
 * not work, so a replaced caregiver whose period covers a day worked it even when
 * a successor backfilled that day's record. The earliest active assignment
 * (replaced ones are candidates; a terminated schedule is one only when it owns a
 * session, so a case ended early still follows its session dates) therefore
 * starts on the first planned session and the latest active one ends on the last
 * one, regardless of which caregiver owns the sessions (ownership in the records
 * and documents stays with the writer). That also keeps a single caregiver's
 * schedule following moved session dates. An outer edge never crosses into a
 * session-less terminated assignment's stored period: when an assignment sorting
 * before the earliest active one stored an end after the new start, or one sorting
 * after the latest active one stored a start before the new end, the stored date
 * is kept, since taking the session date would move that boundary. Every stored
 * assignment is still emitted so the repository re-evaluates each schedule's
 * message automation as before, but only the ones whose service_record_assignment
 * or employee_schedule dates differ from the computed ones are flagged
 * `datesChanged`; those are re-synced in both tables.
 *
 * An edge also stays put when a neighbour merely touches it (a neighbour's stored
 * end equal to the edge's stored start, or the mirror), so a shared boundary is
 * never pulled apart. A terminated edge candidate keeps its contracted period: its
 * start may only move earlier and its end only later, never shrink.
 *
 * The one exception is a single session-less terminated zero-length placeholder (a
 * caregiver replaced before the service started, stored as a one-day period) whose
 * date equals the edge's stored start (or end) and which sits directly before the
 * earliest (after the latest) active assignment: it is no real boundary, only a
 * marker of the same day, so when the edge moves earlier (later) the placeholder
 * moves with it and stays on the edge's date, which keeps the handover invariant
 * (its end == the edge's start). With several such placeholders none moves: the ordinary neighbour
 * guard is what keeps them all in place.
 *
 * Moving an outer edge across any other neighbour's stored boundary cannot be done
 * without moving that boundary, so the stored date is kept silently; changing
 * boundaries belongs to the caregiver replacement flow. An edge candidate that
 * owns no session and whose new edge would fall outside its own period keeps
 * its stored dates and no other assignment takes the edge. Only a session-owning
 * candidate whose computed start falls after its end is refused as a conflict.
 *
 * `historicalOnly` names the assignments whose only sessions are historical
 * writer slots (see service-record-period-ownership.policy). Such an assignment
 * is no period: it is not an edge candidate, not a guard neighbour, not a
 * placeholder and not part of the placeholder ordering. It is emitted with its
 * stored dates at its sorted position. `ownerAssignmentIds` still lists it as an
 * owner: dropping it would turn a terminated one into a session-less
 * placeholder. Without the argument the function is exactly what it was.
 */
export function assignmentWrites(
    source: Pick<ServiceRecordEditSource, "assignments">,
    startDate: string | null,
    endDate: string | null,
    ownerAssignmentIds: ReadonlySet<string>,
    historicalOnly?: ReadonlySet<string>,
): ServiceRecordEditConfirmAssignmentUpdate[] {
    const isHistoricalOnly = (assignment: (typeof source.assignments)[number]) =>
        historicalOnly !== undefined && assignment.id !== null && historicalOnly.has(assignment.id);
    const sessionlessTerminatedRank = (assignment: (typeof source.assignments)[number]) =>
        assignment.scheduleTerminatedAt
        && !(assignment.id !== null && ownerAssignmentIds.has(assignment.id))
        && !isHistoricalOnly(assignment) ? 0 : 1;
    const allStored = source.assignments
        .filter((assignment) => Boolean(assignment.id) && assignment.scheduleId !== null)
        .map((assignment) => {
            const storedStart = assignment.startDate || assignment.scheduleStartDate;
            const storedEnd = assignment.endDate || assignment.scheduleEndDate;
            return {
                assignment,
                storedStart,
                storedEnd,
                startDate: storedStart,
                endDate: storedEnd,
            };
        })
        .sort((left, right) =>
            left.storedStart.localeCompare(right.storedStart)
            || left.storedEnd.localeCompare(right.storedEnd)
            // Identical one-day stored periods: a terminated session-less placeholder sorts before an
            // active one, so it is deterministically on the head side whatever the source order. Longer
            // identical periods keep source order.
            || (left.storedStart === left.storedEnd
                ? sessionlessTerminatedRank(left.assignment) - sessionlessTerminatedRank(right.assignment)
                : 0));
    if (allStored.length === 0) return [];
    // A historical-only assignment takes no part in the edge computation; it is still written below.
    const stored = allStored.filter((item) => !isHistoricalOnly(item.assignment));
    const ownsSession = (item: (typeof stored)[number]) =>
        item.assignment.id !== null && ownerAssignmentIds.has(item.assignment.id);
    const isTerminated = (item: (typeof stored)[number]) => Boolean(item.assignment.scheduleTerminatedAt);
    const activeIndexes = stored
        .map((item, index) => (
            !isTerminated(item) || ownsSession(item) ? index : -1
        ))
        .filter((index) => index >= 0);
    if (activeIndexes.length > 0) {
        const head = stored[activeIndexes[0]!]!;
        const tail = stored[activeIndexes[activeIndexes.length - 1]!]!;
        const first = activeIndexes[0]!;
        const last = activeIndexes[activeIndexes.length - 1]!;
        // A single session-less terminated zero-length placeholder on the edge's own stored date is no
        // boundary: it moves with the edge (see the doc comment). Anything else stays a blocking neighbour.
        const isPlaceholderAt = (item: (typeof stored)[number], date: string) =>
            isTerminated(item) && !ownsSession(item) && item.storedStart === date && item.storedEnd === date;
        const headPlaceholders = stored.slice(0, first).filter((item) => isPlaceholderAt(item, head.storedStart));
        const headPlaceholder = headPlaceholders.length === 1 && stored[first - 1] === headPlaceholders[0]
            ? headPlaceholders[0]
            : undefined;
        const tailPlaceholders = stored.slice(last + 1).filter((item) => isPlaceholderAt(item, tail.storedEnd));
        const tailPlaceholder = tailPlaceholders.length === 1 && stored[last + 1] === tailPlaceholders[0]
            ? tailPlaceholders[0]
            : undefined;
        // A candidate that owns no session (a caregiver replaced before the contract start is stored
        // as a zero-length period) cannot take an edge date beyond its own stored period: keep it.
        // Only a candidate that owns sessions may produce the start-after-end conflict below.
        if (
            startDate
            && stored.slice(0, first).every((item) =>
                (item === headPlaceholder && startDate < head.storedStart)
                || (item.storedEnd < head.storedStart && item.storedEnd <= startDate))
            && (ownsSession(head) || startDate <= head.storedEnd)
            && (!isTerminated(head) || startDate < head.storedStart)
        ) {
            head.startDate = startDate;
            if (headPlaceholder) {
                headPlaceholder.startDate = startDate;
                headPlaceholder.endDate = startDate;
            }
        }
        if (
            endDate
            && stored.slice(last + 1).every((item) =>
                (item === tailPlaceholder && endDate > tail.storedEnd)
                || (item.storedStart > tail.storedEnd && item.storedStart >= endDate))
            && (ownsSession(tail) || endDate >= tail.storedStart)
            && (!isTerminated(tail) || endDate > tail.storedEnd)
        ) {
            tail.endDate = endDate;
            if (tailPlaceholder) {
                tailPlaceholder.startDate = endDate;
                tailPlaceholder.endDate = endDate;
            }
        }
    }
    return allStored.map((item) => {
        if (!item.startDate || !item.endDate || item.startDate > item.endDate) {
            throw new ServiceRecordEditConflictError(
                `Assignment ${item.assignment.id} would be written with its start after its end`,
            );
        }
        return {
            assignmentId: item.assignment.id,
            scheduleId: item.assignment.scheduleId,
            startDate: item.startDate,
            endDate: item.endDate,
            // Both tables must already hold the computed dates, else they are re-synced.
            datesChanged: item.startDate !== item.assignment.startDate
                || item.startDate !== item.assignment.scheduleStartDate
                || item.endDate !== item.assignment.endDate
                || item.endDate !== item.assignment.scheduleEndDate,
        };
    });
}

/**
 * The assignment writes of a confirm that moves no boundary on purpose: the
 * outer-edge rule of `assignmentWrites` over the planned sessions. The edge
 * dates are the first and the last planned session whose owner is not
 * historical-only (stored periods decide which sessions are historical); a
 * session of a mixed owner, one with a legitimate session as well, still counts.
 * Every owner of the vector stays in the owner set, so a terminated one that
 * wrote a session is never mistaken for a session-less placeholder. Without a
 * historical-only owner the edges are the first and last planned dates, exactly
 * as before.
 */
export function confirmAssignmentWrites(
    source: Pick<ServiceRecordEditSource, "assignments"> & Pick<PeriodOwnershipSource, "sessions">,
    entries: readonly SharedPlannedSession[],
): ServiceRecordEditConfirmAssignmentUpdate[] {
    const { historicalOnly } = classifyPeriodOwnership(source, entries);
    const edgeEntries = entries.filter((entry) => !historicalOnly.has(entry.assignmentId));
    return assignmentWrites(
        source,
        edgeEntries[0]?.serviceDate ?? null,
        edgeEntries.at(-1)?.serviceDate ?? null,
        new Set(entries.map((entry) => entry.assignmentId)),
        historicalOnly,
    );
}

/** Surface the first blocking reason as a PATCH-time validation error. */
function throwFirstReason(reasons: ServiceRecordEditPreviewBlockingReason[]): void {
    const first = reasons[0];
    if (first) throw new ServiceRecordScheduleValidationError(first.code, first.message, first.sessionIndex ?? null);
}

/**
 * Merge a PATCH onto the durable draft and normalize any date move or whole-set
 * schedule replacement once.
 *
 * `calendar` is the branch calendar without a client policy. The stored client
 * toggles shape the "before" projection; the pending toggles (the replacement's,
 * else the draft's earlier ones, else the stored ones) shape every date check.
 */
export function normalizeServiceRecordEditChanges(
    source: ServiceRecordEditSource,
    previousValue: ServiceRecordEditJsonValue | undefined,
    incomingValue: ServiceRecordEditJsonValue,
    calendar: KrBusinessDayCalendar,
    dateMove?: ServiceRecordEditDateMove,
    schedule?: ServiceRecordEditScheduleReplacement,
    resumeReplan?: ServiceRecordEditResumeReplan,
): DraftNormalizationResult {
    const previous = asRecord(previousValue) ?? {};
    const incoming = asRecord(incomingValue) ?? {};
    const previousSessions = sessionChanges(previous["sessions"]);
    const incomingSessions = sessionChanges(incoming["sessions"]);
    const hasDateSnapshot = [...previousSessions, ...incomingSessions].some((session) => typeof session["serviceDate"] === "string");
    const output: ServiceRecordEditJsonObject = {};
    const header = mergeHeader(previous["header"], incoming["header"]);
    if (header !== undefined) output["header"] = header;
    const storedPolicy = storedServiceDays(source);
    // serviceDays is server-produced: a replacement sets it, otherwise it is carried forward.
    const draftPolicy = schedule?.serviceDays ?? draftServiceDays(previousValue);
    if (draftPolicy) {
        output["serviceDays"] = {
            saturday: draftPolicy.saturday,
            sunday: draftPolicy.sunday,
            holiday: draftPolicy.holiday,
        };
    }
    // The resume-replan marker is server-produced: a new request sets it, otherwise it is carried forward.
    const previousResume = draftResumeReplan(previousValue);
    const resumeMarker = resumeReplan ?? previousResume;
    const combinationRejection = (message: string) => new ServiceRecordScheduleValidationError(
        "RESUME_REPLAN_COMBINATION",
        message,
    );
    if (resumeMarker) {
        if (dateMove || schedule) {
            throw combinationRejection("A resume replan cannot be combined with a date move or a schedule replacement");
        }
        output["resumeReplan"] = resumeMarkerJson(resumeMarker);
    }
    if (resumeReplan) {
        if (draftPolicy) {
            throw combinationRejection("A resume replan cannot follow a schedule replacement");
        }
        if (!previousResume && previousSessions.some((session) => typeof session["serviceDate"] === "string")) {
            throw combinationRejection("A resume replan cannot follow an earlier manual date change in the same draft");
        }
    }
    if (!dateMove && !schedule && !resumeReplan && !hasDateSnapshot) {
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

    const storedCalendar = calendar.withServiceDays(storedPolicy);
    const pendingCalendar = calendar.withServiceDays(draftPolicy ?? storedPolicy);
    const projection = resolveServiceRecordScheduleProjection(source, storedCalendar);
    if (projection.blockingReasons.length > 0) {
        throw new ServiceRecordScheduleValidationError(
            projection.blockingReasons[0]!.code,
            projection.blockingReasons[0]!.message,
            projection.blockingReasons[0]!.sessionIndex ?? null,
        );
    }

    if (schedule) {
        const before = projection.entries;
        if (schedule.dates.length !== before.length) {
            throw new ServiceRecordScheduleValidationError(
                "SCHEDULE_COUNT_MISMATCH",
                `Expected ${before.length} service dates but received ${schedule.dates.length}`,
            );
        }
        // Provenance (assignment, schedule, employee, version, original date) stays with
        // each index; only the date is replaced. Order is the caller's: never sorted here.
        const replaced = before.map((entry, index) => ({ ...entry, serviceDate: schedule.dates[index]! }));
        const validated = validateServiceRecordScheduleVector(replaced, before.length, pendingCalendar, { persisted: true });
        throwFirstReason([
            ...lockedSessionReasons(source, before, validated),
            ...scheduleReplacementReasons(source, before, validated, pendingCalendar),
        ]);
        const content = mergedContentChanges(previousSessions, incomingSessions);
        for (const entry of validated) {
            const current = content.get(entry.sessionIndex) ?? { sessionIndex: entry.sessionIndex };
            current["serviceDate"] = entry.serviceDate;
            content.set(entry.sessionIndex, current);
        }
        output["sessions"] = [...content.values()].sort((left, right) => left.sessionIndex - right.sessionIndex);
        return { changes: output, entries: validated };
    }

    if (resumeReplan) {
        const planned = planResumeReplan(source, projection.entries, resumeReplan, pendingCalendar);
        const plannedByIndex = new Map(planned.entries.map((entry) => [entry.sessionIndex, entry.serviceDate]));
        for (const session of incomingSessions) {
            const incomingDate = session["serviceDate"];
            if (typeof incomingDate === "string" && incomingDate !== plannedByIndex.get(session.sessionIndex)) {
                throw combinationRejection("A resume replan cannot be combined with a per-session date change");
            }
        }
        // Dates always restart from the source projection: earlier overrides are dropped here.
        const content = mergedContentChanges(previousSessions, incomingSessions);
        for (const entry of planned.entries) {
            if (entry.sessionIndex < resumeReplan.fromSessionIndex) continue;
            const currentChange = content.get(entry.sessionIndex) ?? { sessionIndex: entry.sessionIndex };
            currentChange["serviceDate"] = entry.serviceDate;
            content.set(entry.sessionIndex, currentChange);
        }
        output["sessions"] = [...content.values()]
            // An earlier override leaves only its index behind once its date is dropped.
            .filter((change) => Object.keys(change).length > 1)
            .sort((left, right) => left.sessionIndex - right.sessionIndex);
        return { changes: output, entries: planned.entries };
    }

    const current = currentDateOverrides(projection.entries, previousSessions);
    const incomingDateOverrides = new Map(incomingSessions
        .filter((change) => typeof change["serviceDate"] === "string")
        .map((change) => [change.sessionIndex, change["serviceDate"] as string]));
    if (!dateMove) {
        for (const [sessionIndex, serviceDate] of incomingDateOverrides) {
            const currentEntry = current.find((entry) => entry.sessionIndex === sessionIndex);
            if (currentEntry && currentEntry.serviceDate !== serviceDate) {
                if (previousResume) {
                    throw combinationRejection("A per-session date change cannot follow a resume replan");
                }
                throw new ServiceRecordScheduleValidationError(
                    "DATE_MOVE_REQUIRED",
                    "서비스 회차 날짜 변경은 dateMove 작업으로 요청해야 합니다.",
                    sessionIndex,
                );
            }
        }
    }
    let incomingForDates = dateMove ? [] : incomingSessions;
    if (previousResume) {
        // A resume-replan draft keeps its overrides as stored; an echoed (equal) date is not re-shifted.
        incomingForDates = incomingForDates.map((change) => {
            const withoutDate: DraftSessionChange = { ...change };
            delete withoutDate["serviceDate"];
            return withoutDate;
        });
    }
    let sessions = normalizedSessionChanges(projection.entries, previousSessions, incomingForDates, pendingCalendar);
    if (dateMove) {
        if (!draftPolicy && !resumeMarker && isOutsideCaregiverDateWindow(source, dateMove.toDate)) {
            throw new ServiceRecordScheduleValidationError(
                "SERVICE_DATE_OUT_OF_RANGE",
                "고를 수 있는 기간이 아니에요.",
                dateMove.sessionIndex,
            );
        }
        const shifted = moveServiceRecordSessionDate(
            current,
            dateMove.sessionIndex,
            dateMove.toDate,
            dateMove.shiftFollowing ?? true,
            pendingCalendar,
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

/**
 * Each owner's range over the sessions that bear its period. A historical-only
 * owner has no range and is not listed: its kept writer slots are provenance of
 * who wrote a row, never a period.
 */
function previewRanges(
    source: ServiceRecordEditSource,
    entries: SharedPlannedSession[],
    periodOf: AssignmentPeriodOf,
): ServiceRecordEditPreviewAssignmentRange[] {
    const { periodSlots } = classifyPeriodOwnership(source, entries, periodOf);
    return [...periodSlots.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([assignmentId, { slots }]) => ({
        assignmentId,
        scheduleId: slots[0]!.scheduleId,
        employeeId: slots[0]!.employeeId,
        startDate: slots[0]!.serviceDate,
        endDate: slots.at(-1)!.serviceDate,
        provenanceVersion: slots[0]!.provenanceVersion,
    }));
}

/** The periods a resume plan is about to write, else each assignment's stored period. */
function plannedPeriodOf(plan: ServiceRecordEditResumePlan | null | undefined): AssignmentPeriodOf {
    if (!plan) return storedPeriod;
    return (assignment) => {
        const write = plan.assignmentWrites.find((candidate) => candidate.assignmentId === assignment.id);
        return write ? { startDate: write.startDate, endDate: write.endDate } : storedPeriod(assignment);
    };
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
): ServiceRecordEditPreviewWithResume {
    const storedPolicy = storedServiceDays(input.source);
    const draftPolicy = draftServiceDays(input.changes);
    const pendingPolicy = draftPolicy ?? storedPolicy;
    // Stored toggles describe the case as it is; the pending toggles judge the new dates.
    const storedCalendar = input.calendar.withServiceDays(storedPolicy);
    const pendingCalendar = input.calendar.withServiceDays(pendingPolicy);
    const projection = resolveServiceRecordScheduleProjection(input.source, storedCalendar);
    const blockingReasons: ServiceRecordEditResumeBlockingReason[] = [...projection.blockingReasons];
    const sourceChanges = asRecord(input.changes) ?? {};
    const draftSessions = sessionChanges(sourceChanges["sessions"]);
    let before = projection.entries;
    let after = projection.entries;
    // A resume-replan draft's plan (dates and the handover of owners) comes from the one shared function.
    const resumeMarker = draftResumeReplan(input.changes);
    const resumeResolution = resumeMarker ? resolveResumeReplan(input.source, input.changes, input.calendar) : null;
    // Ranges are judged against the periods the plan will write, so a kept writer slot is recognised on them.
    const periodOf = plannedPeriodOf(resumeResolution?.plan);
    if (blockingReasons.length === 0) {
        try {
            before = validateServiceRecordScheduleVector(
                projection.entries,
                input.source.requiredSessionCount ?? undefined,
                storedCalendar,
                { persisted: true },
            );
            after = applyStoredDates(before, draftSessions);
            after = validateServiceRecordScheduleVector(after, input.source.requiredSessionCount ?? undefined, pendingCalendar, { persisted: true });
            if (resumeResolution?.plan) after = applyResumeHandover(after, resumeResolution.plan.entries);
            blockingReasons.push(...assignmentRangeReasons(input.source, after, periodOf));
            // 일정 전체 교체는 작성된 날짜를 유지하고, 단일 회차 수정은 작성된 기록을
            // 옮길 수 있지만 제공인력과 같은 기간·서비스일 조건을 지켜야 해요.
            if (draftPolicy) {
                blockingReasons.push(...lockedSessionReasons(input.source, before, after));
                blockingReasons.push(...scheduleReplacementReasons(input.source, before, after, pendingCalendar));
            } else if (!resumeMarker) {
                blockingReasons.push(...writtenDateCorrectionReasons(input.source, before, after, pendingCalendar));
            }
        } catch (error) {
            blockingReasons.push(error instanceof UnsupportedKoreanHolidayYearError
                ? reason("UNSUPPORTED_HOLIDAY_YEAR", error.message)
                : reasonFromError(error));
            before = [];
            after = [];
        }
    }
    // A resume-replan draft adds its boundary preview and warnings, and its own blocking rules.
    let resumeExtras: Pick<ServiceRecordEditPreviewWithResume, "warnings" | "assignmentPeriods"> | null = null;
    if (resumeMarker) {
        if (IMMUTABLE_FINALIZATION_STATUSES.has(input.source.caseLifecycle?.status ?? "")) {
            blockingReasons.push(reason(
                "CASE_FINALIZED",
                "The service record is already finalized, so its sessions can no longer be re-planned",
            ));
        }
        const resolution = resumeResolution;
        const plan = resolution?.plan ?? null;
        if (resolution && !plan) {
            // The projection's own reasons are already reported above.
            if (projection.blockingReasons.length === 0) blockingReasons.push(...resolution.reasons);
        } else if (plan && after.length > 0) {
            const afterByIndex = new Map(after.map((entry) => [entry.sessionIndex, entry.serviceDate]));
            if (plan.entries.some((entry) => afterByIndex.get(entry.sessionIndex) !== entry.serviceDate)) {
                blockingReasons.push(reason(
                    "RESUME_REPLAN_OUT_OF_DATE",
                    "The stored resume replan no longer matches the current calendar; submit it again",
                    resumeMarker.fromSessionIndex,
                ));
            } else {
                resumeExtras = {
                    warnings: resumeReplanWarnings(input.source, after, plan, resumeMarker.fromSessionIndex),
                    assignmentPeriods: plan.assignmentPeriods,
                };
            }
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
        calendarVersion: pendingCalendar.version,
        // Omitted for a non-schedule draft on an all-false client so the preview payload (and
        // its hash) stays byte-identical to the pre-feature shape.
        ...(draftPolicy || storedPolicy.saturday || storedPolicy.sunday || storedPolicy.holiday
            ? { serviceDays: { before: storedPolicy, after: pendingPolicy } }
            : {}),
        before: vectorDates(before),
        after: vectorDates(after),
        provenance: previewRanges(input.source, after, periodOf),
        contentChanges: content,
        impactedAssignments: impactedAssignmentIds,
        impactedAssignmentDetails,
        blockingReasons,
        signatureMetadata: signatureMetadataForPreview(input.source, blockingReasons),
        documentScope: documentScopeForPreview(input.source),
        // Present only for a resume-replan draft (empty when its plan could not be built).
        ...(resumeMarker ? (resumeExtras ?? { warnings: [], assignmentPeriods: [] }) : {}),
    };
}
