import { lockEnabledBabyRecordRollout, requireBabyRecordRollout } from "application/policies/baby-record-rollout.policy";
import type { StartDateChangeMode } from "@babyjamjam/shared/types/start-date-change";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    EFORMSIGN_TOMBSTONE_STATUS,
    EFORMSIGN_TOMBSTONE_STATUSES,
    INITIAL_TERMINAL_PROVIDER_FAILURE_CODES,
    eformsignStatusMatchesSql,
    initialFinalizationStateSql,
    initialTombstoneEvaluatedSql,
    initialTombstoneEvaluationRecordSql,
    newestInitialFinalizationStateSql,
    isInitialFinalizationWorkflowScopeForRevision,
    SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED,
    SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN,
} from "application/policies/service-record-initial-finalization.policy";
import {
    getServiceRecordFinalizationDueAt,
    getServiceRecordTokenExpiresAt,
} from "domain/constants/service-record-link-message";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    EFORMSIGN_REJECTED_STATUS_CODES,
    EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import { UnsupportedKoreanHolidayYearError, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { PrismaService } from "infrastructure/database/prisma.service";
import { INITIAL_PROVIDER_SETTLE_MS } from "infrastructure/database/utils/service-record-initial-recovery-sql";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { resolveServiceRecordCaseTarget } from "./service-record-case-target";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

export const SERVICE_RECORD_CASE_STATUS = {
    WAITING_FOR_DETAILS: "WAITING_FOR_DETAILS",
    WAITING_FOR_ASSIGNMENT: "WAITING_FOR_ASSIGNMENT",
    SCHEDULED: "SCHEDULED",
    IN_PROGRESS: "IN_PROGRESS",
    WAITING_FOR_END: "WAITING_FOR_END",
    AWAITING_COMPLETION: "AWAITING_COMPLETION",
    READY_TO_FINALIZE: "READY_TO_FINALIZE",
    FINALIZING: "FINALIZING",
    DOCUMENTS_CREATED: "DOCUMENTS_CREATED",
    COMPLETED: "COMPLETED",
    FINALIZATION_FAILED: "FINALIZATION_FAILED",
    TERMINATED_REVIEW_REQUIRED: "TERMINATED_REVIEW_REQUIRED",
    MIGRATION_REVIEW_REQUIRED: "MIGRATION_REVIEW_REQUIRED",
} as const;

export type ServiceRecordCaseStatus = typeof SERVICE_RECORD_CASE_STATUS[keyof typeof SERVICE_RECORD_CASE_STATUS];

export const IMMUTABLE_FINALIZATION_STATUSES = new Set<string>([
    SERVICE_RECORD_CASE_STATUS.FINALIZING,
    SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
    SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
    SERVICE_RECORD_CASE_STATUS.COMPLETED,
]);

type DbClient = Prisma.TransactionClient | PrismaService;
type InitialSnapshotTerminalOutcomeInput = {
    branchId: string;
    documentId: string;
    /** Captured before purge by staff delete or its vendor retry. */
    deletedDocuments?: ReadonlyArray<{ documentId: string; statusType: string }>;
    fromSweep?: boolean;
};

const initialTombstoneSettledSql = Prisma.sql`doc.updated_date <= now() - (${INITIAL_PROVIDER_SETTLE_MS}::int * interval '1 millisecond')`;
type ServiceRecordCaseRecord = Prisma.service_record_caseGetPayload<Prisma.service_record_caseDefaultArgs>;

const lifecycleClientSelect = {
    id: true,
    branchId: true,
    deletedAt: true,
    fetalConfirmation: true,
    startDate: true,
    endDate: true,
    duration: true,
    serviceStatus: true,
    bookingConfirmedAt: true,
    allowSaturdayService: true,
    allowSundayService: true,
    allowHolidayService: true,
    employeeSchedules: {
        include: { primaryEmployee: { select: { id: true, name: true, phone: true } } },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
    },
} satisfies Prisma.clientSelect;

type LifecycleClient = Prisma.clientGetPayload<{ select: typeof lifecycleClientSelect }>;

type LockedServiceRecordSnapshot = {
    id: number;
    documentId: string;
    branchId: string;
    documentKind: string;
    revisionId: string | null;
    snapshotVersion: number | null;
    statusType: string;
    detailPayload: Prisma.JsonValue | null;
    detailSourceUpdatedDate: Date | null;
    detailSyncedAt: Date | null;
    syncStatus: string;
    permanentPurgeRequestedAt: Date | null;
    hasCurrentDocumentPdf: boolean;
    hasCurrentAuditTrailPdf: boolean;
};

type LockedServiceRecordCaseRevisionState = {
    id: string;
    clientId: number | null;
    version: number;
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    currentUsableDocumentVersion: number | null;
};

function normalizeRevisionId(value: string | null | undefined): string | null {
    return value ?? null;
}

function normalizeSnapshotVersion(value: number | null | undefined): number | null {
    return value ?? null;
}

function hasAuthoritativeRevision(record: {
    currentRevisionId?: string | null;
    currentUsableRevisionId?: string | null;
    currentUsableDocumentVersion?: number | null;
    plannedSessions?: Prisma.JsonValue | null;
}): boolean {
    return record.currentRevisionId != null
        || record.currentUsableRevisionId != null
        || record.currentUsableDocumentVersion != null
        || record.plannedSessions != null;
}

/**
 * Whether an existing case keeps its stored N as-is (no calendar needed): a case
 * with an authoritative revision, or a legacy case with a stored N whose period
 * did not move. Everything else re-derives N from the branch calendar.
 */
function existingCaseKeepsStoredCount(
    existing: {
        startDate: Date | null;
        endDate: Date | null;
        requiredSessionCount: number | null;
        currentRevisionId?: string | null;
        currentUsableRevisionId?: string | null;
        currentUsableDocumentVersion?: number | null;
        plannedSessions?: Prisma.JsonValue | null;
    },
    client: { startDate: Date | null; endDate: Date | null },
): boolean {
    const periodChanged = isoDate(existing.startDate) !== isoDate(client.startDate)
        || isoDate(existing.endDate) !== isoDate(client.endDate);
    return hasAuthoritativeRevision(existing)
        || (existing.requiredSessionCount !== null && !periodChanged);
}

function legacySessionCount(
    startDate: Date | null,
    endDate: Date | null,
    storedCount: number | null,
    calendar: KrBusinessDayCalendar,
): number | null {
    try {
        return serviceRecordSessionCount(startDate, endDate, storedCount, calendar);
    } catch (error) {
        // Unsupported legacy years remain visible and retain their stored N;
        // the editor/preview path carries the explicit calendar blocker.
        if (error instanceof UnsupportedKoreanHolidayYearError) return storedCount;
        throw error;
    }
}

/**
 * A legacy snapshot has no revision identity. It remains eligible only for a
 * case that has no revision evidence at all; a null-revision callback must not
 * complete a case which has since entered the revision-backed lifecycle.
 */
function isLegacyCaseRevisionState(state: {
    currentRevisionId: string | null | undefined;
    currentUsableRevisionId: string | null | undefined;
    currentUsableDocumentVersion: number | null | undefined;
}): boolean {
    return normalizeRevisionId(state.currentRevisionId) === null
        && normalizeRevisionId(state.currentUsableRevisionId) === null
        && normalizeSnapshotVersion(state.currentUsableDocumentVersion) === null;
}

function isoDate(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function todayKst(now: Date): string {
    return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function deriveInitialSessionCount(params: {
    startDate: Date | null;
    endDate: Date | null;
    calendar: KrBusinessDayCalendar;
}): number | null {
    const startDate = isoDate(params.startDate);
    const endDate = isoDate(params.endDate);
    if (!startDate || !endDate) return null;
    try {
        const count = params.calendar.countBusinessDays(startDate, endDate);
        return count && count > 0 ? count : null;
    } catch {
        // Unsupported years and malformed periods remain viewable as legacy
        // data, but they cannot initialize a new authoritative N.
        return null;
    }
}

function isWithinServicePeriod(serviceDate: Date, startDate: Date | null, endDate: Date | null): boolean {
    const serviceDateIso = isoDate(serviceDate);
    const startDateIso = isoDate(startDate);
    const endDateIso = isoDate(endDate);
    if (!serviceDateIso || !startDateIso || !endDateIso) return true;
    return serviceDateIso >= startDateIso && serviceDateIso <= endDateIso;
}

function isWithinCaregiverDateWindow(serviceDate: Date, startDate: Date | null, endDate: Date | null): boolean {
    const offset = (date: Date, days: number): Date => {
        const copy = new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
        copy.setUTCDate(copy.getUTCDate() + days);
        return copy;
    };
    return isWithinServicePeriod(
        new Date(`${serviceDate.toISOString().slice(0, 10)}T00:00:00.000Z`),
        startDate ? offset(startDate, -7) : serviceDate,
        endDate ? offset(endDate, 7) : serviceDate,
    );
}

function hasCompleteHeader(record: {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
}): boolean {
    return [
        record.momName,
        record.momBirth,
        record.babyName,
        record.babyBirth,
        record.deliveryType,
        record.babyWeight,
    ].every((value) => Boolean(value?.trim()));
}

function isCurrentMirrorSnapshotVersion(
    snapshot: LockedServiceRecordSnapshot,
    mirrorVersion: {
        detailSourceUpdatedDate: Date;
        detailSyncedAt: Date;
    } | undefined,
): boolean {
    if (!isReadyCurrentSnapshot(snapshot)) return false;
    if (!mirrorVersion) return true;
    return snapshot.detailSourceUpdatedDate?.getTime() === mirrorVersion.detailSourceUpdatedDate.getTime()
        && snapshot.detailSyncedAt?.getTime() === mirrorVersion.detailSyncedAt.getTime();
}

function isReadyCurrentSnapshot(snapshot: LockedServiceRecordSnapshot): boolean {
    return snapshot.detailPayload !== null
        && snapshot.detailSourceUpdatedDate !== null
        && snapshot.detailSyncedAt !== null
        && snapshot.syncStatus === "ready"
        && !snapshot.permanentPurgeRequestedAt
        && snapshot.hasCurrentDocumentPdf
        && snapshot.hasCurrentAuditTrailPdf;
}

/** The few caller frames above the lifecycle service, for the in-transaction calendar warning. */
function callPath(): string {
    return (new Error().stack ?? "").split("\n").slice(1)
        .map((line) => line.trim().replace(/^at (async )?/, ""))
        .filter((line) => line && !/service-record-lifecycle\.service\.(ts|js)/.test(line))
        .slice(0, 3).join(" <- ") || "unknown";
}

export interface StartDateChangeDecision {
    mode: StartDateChangeMode;
    previousStartDate: Date | null;
    recordedSessionCount: number;
    cases?: Array<{ caseId: string; previousStartDate: Date | null; recordedSessionCount: number }>;
}

@Injectable()
export class ServiceRecordLifecycleService {
    private readonly logger = new Logger(ServiceRecordLifecycleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    async ensureForSchedule(scheduleId: number, tx?: Prisma.TransactionClient): Promise<ServiceRecordCaseRecord | null> {
        const [record] = await this.ensureScheduleCases(scheduleId, tx, true);
        return record ?? null;
    }

    async ensureAllForSchedule(scheduleId: number, tx?: Prisma.TransactionClient): Promise<ServiceRecordCaseRecord[]> {
        return this.ensureScheduleCases(scheduleId, tx, false);
    }

    private async ensureScheduleCases(scheduleId: number, tx: Prisma.TransactionClient | undefined, single: boolean) {
        const schedule = await (tx ?? this.prisma).employee_schedule.findUnique({
            where: { id: scheduleId },
            select: { clientId: true, branchId: true },
        });
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return this.ensureCases(schedule.clientId, tx, undefined, single, { ...schedule, id: scheduleId });
    }

    async ensureForClient(
        clientId: number,
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<ServiceRecordCaseRecord | null> {
        const [record] = await this.ensureCases(clientId, tx, calendar, true);
        return record ?? null;
    }

    async ensureAllForClient(
        clientId: number,
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<ServiceRecordCaseRecord[]> {
        return this.ensureCases(clientId, tx, calendar, false);
    }

    private async ensureCases(
        clientId: number,
        tx: Prisma.TransactionClient | undefined,
        calendar: KrBusinessDayCalendar | undefined,
        single: boolean,
        scheduleTarget?: { id: number; clientId: number; branchId: string | null },
    ): Promise<ServiceRecordCaseRecord[]> {
        if (!tx && typeof this.prisma.$transaction === "function") {
            const resolved = calendar ?? await this.resolveCalendarBeforeTransaction(clientId);
            return this.prisma.$transaction((transaction) =>
                this.ensureForClientInTransaction(clientId, transaction, resolved, single, scheduleTarget));
        }
        return this.ensureForClientInTransaction(clientId, tx, calendar, single, scheduleTarget, tx && !calendar ? callPath() : undefined);
    }

    /**
     * Reads the branch calendar (fresh) ahead of an owning transaction, but only
     * when `ensureForClientInTransaction` is going to need it: a brand-new case,
     * or an existing one whose N must be re-derived. Returns undefined when the
     * branch or period is missing or the stored N is kept; the in-transaction
     * lazy read then stays as a rare fallback (a case created between this read
     * and the transaction).
     *
     * A caller that opens its own `$transaction` must call this before opening
     * it and hand the result to `ensureForClient(..., calendar)`: the calendar
     * service reads through the root client, so reading it from inside the
     * transaction holds one pooled connection while waiting for a second.
     * `pendingPeriod` carries a client period the caller is about to write inside
     * that transaction, so the check judges the period `ensureForClient` will see.
     */
    async resolveCalendarBeforeTransaction(
        clientId: number,
        pendingPeriod?: { startDate?: Date | null; endDate?: Date | null },
    ): Promise<KrBusinessDayCalendar | undefined> {
        const client = await this.prisma.client.findUnique({
            where: { id: clientId },
            select: {
                branchId: true,
                startDate: true,
                endDate: true,
                fetalConfirmation: true,
                employeeSchedules: {
                    select: { branchId: true },
                    orderBy: [{ startDate: "asc" }, { id: "asc" }],
                },
            },
        });
        if (!client) return undefined;
        const period = {
            startDate: pendingPeriod?.startDate !== undefined ? pendingPeriod.startDate : client.startDate,
            endDate: pendingPeriod?.endDate !== undefined ? pendingPeriod.endDate : client.endDate,
        };
        if (!period.startDate) return undefined;
        const branchId = client.branchId
            ?? client.employeeSchedules.find((schedule) => schedule.branchId)?.branchId
            ?? null;
        if (!branchId) return undefined;
        const scope = { branchId, clientId };
        const existing = await this.prisma.service_record_case.findMany({ where: scope });
        if (existing.length && existing.every((record) => existingCaseKeepsStoredCount(record, period))) {
            if (client.fetalConfirmation !== "CONFIRMED" || existing.some(({ babyId }) => babyId === null)) return undefined;
            const missing = await this.prisma.client_baby.count({
                where: { ...scope, active: true, id: { notIn: existing.flatMap(({ babyId }) => babyId ? [babyId] : []) } },
            });
            if (missing === 0) return undefined;
        }
        return this.holidayCalendar.forBranch(branchId, { fresh: true });
    }

    private async ensureForClientInTransaction(
        clientId: number,
        tx: Prisma.TransactionClient | undefined,
        passedCalendar: KrBusinessDayCalendar | undefined,
        single: boolean,
        scheduleTarget?: { id: number; clientId: number; branchId: string | null },
        caller?: string,
    ): Promise<ServiceRecordCaseRecord[]> {
        const db = tx ?? this.prisma;
        const loadClient = () => db.client.findUnique({ where: { id: clientId }, select: lifecycleClientSelect });
        let client = await loadClient();
        if (!client) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const owningBranch = (row: LifecycleClient) =>
            row.branchId ?? row.employeeSchedules.find((schedule) => schedule.branchId)?.branchId ?? null;
        const branchId = owningBranch(client);
        if (!branchId || client.deletedAt) return [];

        const scope = { branchId, clientId };
        if (tx && typeof tx.$queryRaw === "function") {
            await lockServiceRecordWriteSet(tx, scope);
            client = await loadClient();
            if (!client || client.deletedAt || owningBranch(client) !== branchId) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            if (scheduleTarget && !client.employeeSchedules.some(({ id, branchId, clientId }) =>
                id === scheduleTarget.id && branchId === scheduleTarget.branchId && clientId === scheduleTarget.clientId)) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
        }
        if (!client.startDate) return [];
        const existing = await db.service_record_case.findMany({ where: scope, orderBy: { id: "asc" } });
        const babies = client.fetalConfirmation === "CONFIRMED"
            ? await db.client_baby.findMany({ where: { ...scope, active: true }, select: { id: true }, orderBy: { ordinal: "asc" } })
            : [];
        // Legacy consumers may only act on an unambiguous household.
        if (single && (babies.length > 1 || existing.length > 1)) return [];
        const unbound = existing.find(({ babyId }) => babyId === null);
        const isPreBooking = getEffectiveClientServiceStatus(
            client.serviceStatus, client.startDate, client.endDate, client.bookingConfirmedAt,
        ) === "pre_booking";
        if (unbound && babies.length > 1) return [unbound];
        if (client.fetalConfirmation === "CONFIRMED" && babies.length === 0) return [];
        if (babies.length === 0 && existing.some(({ babyId }) => babyId !== null)) return [];

        const targets = unbound || babies.length === 0
            ? [{ babyId: null, existing: unbound }]
            : babies.map(({ id }) => ({ babyId: id, existing: existing.find(({ babyId }) => babyId === id) }));
        let calendar = passedCalendar;
        const resolveCalendar = async () => {
            if (!calendar) {
                if (tx) {
                    this.logger.warn(
                        `[CALENDAR_READ_INSIDE_TRANSACTION] clientId=${clientId} branchId=${branchId} — `
                        + `Resolve the calendar before opening the transaction. callPath=${caller ?? "unknown"}`,
                    );
                }
                calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
            }
            return withClientServiceDays(calendar, client);
        };
        const schedules = client.employeeSchedules.filter((schedule) => schedule.branchId === branchId);
        const owners = babies.length > 0 && !unbound
            ? await db.service_record_baby_assignment.findMany({
                where: { ...scope, babyId: { in: babies.map(({ id }) => id) } },
                select: {
                    babyId: true, scheduleId: true, activeOwner: true,
                    employee: { select: { id: true, name: true, phone: true } },
                },
                orderBy: [{ version: "desc" }, { id: "asc" }],
            })
            : [];
        const canCreateBabyArtifacts = babies.length > 0 && !unbound && !isPreBooking
            && !!tx && await lockEnabledBabyRecordRollout(tx, branchId);
        const records: ServiceRecordCaseRecord[] = [];
        for (const target of targets) {
            if (!target.existing && (isPreBooking || (target.babyId !== null && !canCreateBabyArtifacts))) continue;
            const ownedSchedules = schedules.flatMap((schedule) => {
                if (target.babyId === null) return [{ schedule, employee: schedule.primaryEmployee }];
                const owner = owners.find((candidate) => candidate.babyId === target.babyId
                    && candidate.scheduleId === schedule.id && (schedule.replaced || candidate.activeOwner === true));
                return [{ schedule, employee: owner?.employee ?? null }];
            });
            records.push(await this.syncCase(db, tx, {
                ...scope, ...target, client, ownedSchedules, resolveCalendar,
                legacyArtifacts: target.babyId === null && existing.length <= 1,
                canCreateBabyArtifacts,
            }));
        }
        return records;
    }

    private async syncCase(db: DbClient, tx: Prisma.TransactionClient | undefined, params: {
        branchId: string;
        clientId: number;
        babyId: string | null;
        existing: ServiceRecordCaseRecord | undefined;
        client: LifecycleClient;
        ownedSchedules: Array<{
            schedule: LifecycleClient["employeeSchedules"][number];
            employee: { id: number; name: string; phone: string | null } | null;
        }>;
        resolveCalendar: () => Promise<KrBusinessDayCalendar>;
        legacyArtifacts: boolean;
        canCreateBabyArtifacts: boolean;
    }): Promise<ServiceRecordCaseRecord> {
        const { branchId, clientId, babyId, existing, client, ownedSchedules, resolveCalendar, legacyArtifacts } = params;
        if (existing && (IMMUTABLE_FINALIZATION_STATUSES.has(existing.status)
            || existing.status === SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED)) return existing;

        const sessionCount = existing
            ? existingCaseKeepsStoredCount(existing, client)
                ? existing.requiredSessionCount
                : legacySessionCount(client.startDate, client.endDate, existing.requiredSessionCount, await resolveCalendar())
            : deriveInitialSessionCount({
                startDate: client.startDate, endDate: client.endDate, calendar: await resolveCalendar(),
            });
        if (!existing && client.duration === null && sessionCount !== null && typeof db.client.updateMany === "function") {
            await db.client.updateMany({ where: { id: clientId, branchId, duration: null }, data: { duration: sessionCount } });
        }

        const period = {
            startDate: client.startDate,
            endDate: client.endDate,
            requiredSessionCount: sessionCount,
            finalizationDueAt: client.endDate ? getServiceRecordFinalizationDueAt(client.endDate) : null,
        };
        const terminated = client.serviceStatus === "terminated";
        const status = this.deriveBaseStatus({
            ...period,
            duration: sessionCount,
            hasAssignment: ownedSchedules.some(({ schedule, employee }) => !schedule.replaced && !!employee),
            terminated,
        });
        const periodChanged = existing && (
            isoDate(existing.startDate) !== isoDate(period.startDate)
            || isoDate(existing.endDate) !== isoDate(period.endDate)
            || existing.requiredSessionCount !== period.requiredSessionCount
        );
        const wasTerminated = existing?.status === SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED;
        // Recompute treats termination as terminal, so persist the transition first.
        const caseChanged = periodChanged || wasTerminated !== terminated;
        const record = !existing
            ? await db.service_record_case.create({ data: { ...period, branchId, clientId, babyId, status } })
            : caseChanged
                ? await db.service_record_case.update({
                    where: { id: existing.id, branchId },
                    data: { ...period, status, ...(terminated ? { version: { increment: 1 } } : {}) },
                })
                : existing;

        const serviceRecordCaseId = record.id;
        const caseScope = { branchId, serviceRecordCaseId };
        const schedules = ownedSchedules.map(({ schedule }) => schedule);
        const scheduleIds = schedules.map(({ id }) => id);

        const assignments = scheduleIds.length ? await db.service_record_assignment.findMany({ where: caseScope }) : [];
        let assignmentChanged = false;
        for (const { schedule, employee } of ownedSchedules) {
            const assignment = assignments.find(({ scheduleId }) => scheduleId === schedule.id);
            if (!employee && !assignment) continue;
            const data = {
                employeeId: employee?.id ?? null,
                employeeNameSnapshot: employee?.name ?? assignment?.employeeNameSnapshot ?? "",
                employeePhoneSnapshot: employee ? employee.phone : assignment?.employeePhoneSnapshot ?? null,
                startDate: schedule.startDate,
                endDate: schedule.endDate,
            };
            if (!assignment) {
                if (babyId !== null && !params.canCreateBabyArtifacts) continue;
                await db.service_record_assignment.create({ data: { ...caseScope, scheduleId: schedule.id, ...data } });
                assignmentChanged = true;
            } else if (assignment.employeeId !== data.employeeId
                || assignment.employeeNameSnapshot !== data.employeeNameSnapshot
                || assignment.employeePhoneSnapshot !== data.employeePhoneSnapshot
                || isoDate(assignment.startDate) !== isoDate(data.startDate)
                || isoDate(assignment.endDate) !== isoDate(data.endDate)) {
                await db.service_record_assignment.update({ where: { id: assignment.id, ...caseScope }, data });
                assignmentChanged = true;
            }
        }

        if (scheduleIds.length > 0 && legacyArtifacts) {
            const unresolved = { branchId, scheduleId: { in: scheduleIds }, serviceRecordCaseId: null };
            const linkedHeaders = await db.service_record.findMany({ where: caseScope, select: { scheduleId: true } });
            await db.service_record.updateMany({
                where: { ...unresolved, scheduleId: { in: scheduleIds, notIn: linkedHeaders.map(({ scheduleId }) => scheduleId) } },
                data: { serviceRecordCaseId },
            });
            await db.service_record_token.updateMany({ where: unresolved, data: { serviceRecordCaseId } });
            await db.eformsign_doc.updateMany({
                where: {
                    branchId, employeeScheduleId: { in: scheduleIds }, serviceRecordCaseId: null,
                    documentKind: "service_record_snapshot", revisionId: null,
                },
                data: { serviceRecordCaseId },
            });
            await this.linkLegacyDays(serviceRecordCaseId, schedules, db, branchId);
        }
        if (scheduleIds.length > 0 && babyId !== null && params.canCreateBabyArtifacts) {
            const headers = await db.service_record.findMany({ where: caseScope, select: { scheduleId: true } });
            const missing = ownedSchedules.flatMap(({ schedule, employee }) =>
                !headers.some(({ scheduleId }) => scheduleId === schedule.id) && (!schedule.replaced || employee)
                    ? [schedule.id] : []);
            if (missing.length) {
                await db.service_record.createMany({ data: missing.map((scheduleId) => ({ ...caseScope, scheduleId })) });
            }
        }
        if (client.endDate) {
            const tokenExpiresAt = getServiceRecordTokenExpiresAt(client.endDate);
            await db.service_record_token.updateMany({
                where: { ...caseScope, active: true, revokedAt: null, expiresAt: { lt: tokenExpiresAt } },
                data: { expiresAt: tokenExpiresAt },
            });
        }
        const calendar = sessionCount === null ? await resolveCalendar() : undefined;
        return this.recompute(serviceRecordCaseId, tx, calendar, {
            preserveVersion: !!existing && !caseChanged && !assignmentChanged,
        });
    }

    async linkLegacyCaseToBaby(
        params: { branchId: string; clientId: number; caseId: string; babyId: string },
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<{ caseId: string; babyId: string }> {
        if (tx) return this.adoptLegacyCase(tx, params, calendar);
        const { branchId, clientId, caseId } = params;
        const target = await resolveServiceRecordCaseTarget(this.prisma, { branchId, clientId, caseId });
        if (target.kind !== "resolved") throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const resolvedCalendar = calendar ?? await this.holidayCalendar.forBranch(branchId, { fresh: true });
        return this.prisma.$transaction((transaction) => this.adoptLegacyCase(transaction, params, resolvedCalendar));
    }

    private async adoptLegacyCase(
        tx: Prisma.TransactionClient,
        params: { branchId: string; clientId: number; caseId: string; babyId: string },
        calendar?: KrBusinessDayCalendar,
    ) {
        const { branchId, clientId, caseId } = params;
        const scope = { branchId, clientId };
        const found = await resolveServiceRecordCaseTarget(tx, { ...scope, caseId });
        if (found.kind !== "resolved") throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        await lockServiceRecordWriteSet(tx, scope);
        const target = await resolveServiceRecordCaseTarget(tx, { ...scope, caseId });
        if (target.kind !== "resolved") throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        const [baby] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM client_baby
            WHERE branch_id = ${branchId}::uuid AND client_id = ${clientId} AND id::text = ${params.babyId.toLowerCase()} AND active
            FOR UPDATE
        `);
        if (!baby || target.babyCount === null) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const result = { caseId: target.caseId, babyId: baby.id };
        if (target.babyId === baby.id) return result;
        if (target.babyId !== null || await tx.service_record_case.count({ where: { ...scope, babyId: baby.id } })) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        await requireBabyRecordRollout(tx, branchId);
        const changed = await tx.service_record_case.updateMany({
            where: { ...scope, id: target.caseId, babyId: null },
            data: { babyId: baby.id },
        });
        if (changed.count !== 1) throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        await this.ensureAllForClient(clientId, tx, calendar);
        return result;
    }

    async validatePeriodChange(params: {
        clientId: number;
        branchId?: string;
        startDate?: Date | null;
        endDate?: Date | null;
        duration?: number | null;
        now?: Date;
        startDateChangeMode?: StartDateChangeMode;
    }, tx?: Prisma.TransactionClient): Promise<StartDateChangeDecision | null> {
        const db = tx ?? this.prisma;
        const records = await db.service_record_case.findMany({
            where: { clientId: params.clientId, branchId: params.branchId },
            include: { days: { select: { serviceDate: true, locked: true, caseSessionIndex: true, sessionIndex: true } } },
            orderBy: { id: "asc" },
        });
        const decisions = records.flatMap((record) => {
            const decision = this.validateCasePeriodChange(record, params);
            return decision ? [{ caseId: record.id, ...decision }] : [];
        });
        const first = decisions[0];
        if (!first) return null;
        return {
            mode: first.mode,
            previousStartDate: first.previousStartDate,
            recordedSessionCount: decisions.reduce((total, decision) => total + decision.recordedSessionCount, 0),
            ...(records.length > 1 ? { cases: decisions } : {}),
        };
    }

    private validateCasePeriodChange(
        record: Pick<ServiceRecordCaseRecord, "status" | "startDate" | "endDate" | "requiredSessionCount"> & {
            days: Array<{ serviceDate: Date; locked: boolean; caseSessionIndex: number | null; sessionIndex: number }>;
        },
        params: {
            startDate?: Date | null; endDate?: Date | null; duration?: number | null;
            now?: Date; startDateChangeMode?: StartDateChangeMode;
        },
    ): StartDateChangeDecision | null {
        const now = params.now ?? new Date();

        if (IMMUTABLE_FINALIZATION_STATUSES.has(record.status)) {
            const dateChanged = (
                params.startDate !== undefined && isoDate(params.startDate) !== isoDate(record.startDate)
            ) || (
                params.endDate !== undefined && isoDate(params.endDate) !== isoDate(record.endDate)
            ) || (
                params.duration !== undefined && params.duration !== record.requiredSessionCount
            );
            if (dateChanged) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_FINALIZED"));
            }
        }

        let decision: StartDateChangeDecision | null = null;
        const serviceStarted = record.startDate != null && todayKst(now) >= isoDate(record.startDate)!;
        const recordedSessionCount = record.days.length;
        if (
            params.startDate !== undefined
            && isoDate(params.startDate) !== isoDate(record.startDate)
            && (recordedSessionCount > 0 || serviceStarted)
        ) {
            const mode = params.startDateChangeMode;
            if (!mode || (recordedSessionCount > 0 && mode !== "RESTART" && mode !== "MOVE")) {
                throw new ConflictException({
                    ...codeOnlyProblemBody("SERVICE_RECORD_START_DATE_LOCKED"),
                    startDateLock: { serviceStarted, recordedSessionCount },
                });
            }
            decision = { mode, previousStartDate: record.startDate, recordedSessionCount };
        }

        if (params.endDate === null && record.days.length > 0) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_END_DATE_REQUIRED"));
        }
        if (
            params.endDate !== undefined
            && params.endDate !== null
            && isoDate(params.endDate) !== isoDate(record.endDate)
            && decision?.mode !== "RESTART"
            && record.days.some((day) => {
                // MOVE가 재배치하는 회차는 기존 날짜로 종료일을 제한하지 않는다.
                if (decision?.mode === "MOVE" && record.requiredSessionCount !== null && record.requiredSessionCount > 0) {
                    const sessionIndex = day.caseSessionIndex ?? day.sessionIndex;
                    if (sessionIndex != null && sessionIndex <= record.requiredSessionCount) return false;
                }
                return day.locked && isoDate(day.serviceDate)! > isoDate(params.endDate)!;
            })
        ) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_END_DATE_BEFORE_LOCKED_SESSION"));
        }
        if (params.duration === null && record.days.length > 0) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_DURATION_REQUIRED"));
        }
        if (
            params.duration !== undefined
            && params.duration !== null
            && record.requiredSessionCount !== null
            && params.duration < record.requiredSessionCount
            && record.days.length > 0
        ) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_DURATION_CANNOT_DECREASE"));
        }
        return decision;
    }

    async syncEndDateFromContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
    }): Promise<void> {
        // Saved computation: resolve the branch calendar before the transaction opens.
        const calendar = await this.holidayCalendar.forBranch(params.branchId, { fresh: true });
        await this.prisma.$transaction(async (tx) => {
            await this.syncEndDateFromContractInTransaction(params, tx, calendar);
        });
    }

    /**
     * Synchronize a contract-derived end date only while the completed
     * document remains the current contract for the locked client/revision.
     * A delayed legacy callback may still update its own document row, but it
     * must not roll back a client whose service-record revision is pending or
     * current.
     */
    async syncEndDateFromCurrentContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
        documentId: string;
    }): Promise<boolean> {
        const calendar = await this.holidayCalendar.forBranch(params.branchId, { fresh: true });
        return this.prisma.$transaction(async (tx) => {
            // Legacy unit-test doubles do not model the complete lock surface.
            // Production Prisma transactions always do; retain their historical
            // direct seam while routing real writes through the fence below.
            if (!this.hasCompleteServiceRecordWriteLockSurface(tx)) {
                await this.syncEndDateFromContractInTransaction(params, tx, calendar);
                return true;
            }

            const discoveredDocument = typeof tx.eformsign_doc?.findFirst === "function"
                ? await tx.eformsign_doc.findFirst({
                    where: {
                        documentId: params.documentId,
                        branchId: params.branchId,
                    },
                    select: {
                        id: true,
                    },
                })
                : null;
            const lockedWriteSet = await this.lockClientOwnedWriteSet(tx, {
                branchId: params.branchId,
                clientId: params.clientId,
                documentRowId: discoveredDocument?.id,
            });
            if (!lockedWriteSet) return false;

            const currentDocuments = await tx.$queryRaw<Array<{
                id: number;
                clientId: number | null;
                branchId: string | null;
                serviceRecordCaseId: string | null;
                revisionId: string | null;
            }>>(Prisma.sql`
                SELECT id,
                       client_id AS "clientId",
                       branch_id AS "branchId",
                       service_record_case_id AS "serviceRecordCaseId",
                       revision_id AS "revisionId"
                FROM eformsign_doc
                WHERE document_id = ${params.documentId}
                  AND branch_id = ${params.branchId}::uuid
                  AND permanent_purge_requested_at IS NULL
                  AND voided_at IS NULL
                  AND status_type NOT IN ('047', '049', '099')
                FOR UPDATE
            `);
            const currentDocument = currentDocuments[0];
            if (
                !currentDocument
                || currentDocument.clientId !== params.clientId
                || currentDocument.branchId !== params.branchId
                || (
                    currentDocument.serviceRecordCaseId !== null
                    && !lockedWriteSet.caseIds.includes(currentDocument.serviceRecordCaseId)
                )
            ) {
                return false;
            }

            if (!await this.isCurrentContractWriteTarget(tx, {
                branchId: params.branchId,
                clientId: params.clientId,
                documentId: params.documentId,
                currentDocument,
                caseIds: lockedWriteSet.caseIds,
            })) return false;

            await this.syncEndDateFromContractInTransaction(params, tx, calendar);
            return true;
        });
    }

    async syncEndDateFromMirroredContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
        documentId: string;
        detailSourceUpdatedDate: Date;
        detailSyncedAt: Date;
    }): Promise<boolean> {
        const calendar = await this.holidayCalendar.forBranch(params.branchId, { fresh: true });
        return await this.prisma.$transaction(async (tx) => {
            const completeLockSurface = this.hasCompleteServiceRecordWriteLockSurface(tx);
            const discoveredDocument = completeLockSurface
                && typeof tx.eformsign_doc?.findFirst === "function"
                ? await tx.eformsign_doc.findFirst({
                    where: {
                        documentId: params.documentId,
                        branchId: params.branchId,
                    },
                    select: {
                        id: true,
                        clientId: true,
                        branchId: true,
                        serviceRecordCaseId: true,
                    },
                })
                : null;
            const lockedWriteSet = completeLockSurface
                ? await this.lockClientOwnedWriteSet(tx, {
                    branchId: params.branchId,
                    clientId: params.clientId,
                    documentRowId: discoveredDocument?.id,
                })
                : null;
            if (completeLockSurface && !lockedWriteSet) return false;
            const current = await tx.$queryRaw<Array<{
                id: number;
                clientId?: number | null;
                branchId?: string | null;
                serviceRecordCaseId?: string | null;
                revisionId?: string | null;
            }>>(Prisma.sql`
                SELECT id,
                       client_id AS "clientId",
                       branch_id AS "branchId",
                       service_record_case_id AS "serviceRecordCaseId",
                       revision_id AS "revisionId"
                FROM eformsign_doc
                WHERE document_id = ${params.documentId}
                  AND branch_id = ${params.branchId}::uuid
                  AND detail_source_updated_date = ${params.detailSourceUpdatedDate}
                  AND detail_synced_at = ${params.detailSyncedAt}
                  AND sync_status = 'ready'
                  AND permanent_purge_requested_at IS NULL
                  AND voided_at IS NULL
                  AND EXISTS (
                      SELECT 1
                      FROM eformsign_doc_file AS document_file
                      WHERE document_file.eformsign_doc_id = eformsign_doc.id
                        AND document_file.file_type = 'document'
                        AND document_file.source_updated_date
                          = eformsign_doc.detail_source_updated_date
                  )
                  AND EXISTS (
                      SELECT 1
                      FROM eformsign_doc_file AS audit_trail_file
                      WHERE audit_trail_file.eformsign_doc_id = eformsign_doc.id
                        AND audit_trail_file.file_type = 'audit_trail'
                        AND audit_trail_file.source_updated_date
                          = eformsign_doc.detail_source_updated_date
                  )
                FOR UPDATE
            `);
            const currentDocument = current[0];
            if (current.length !== 1 || !currentDocument) {
                return false;
            }
            if (
                completeLockSurface
                && (
                    currentDocument.clientId !== params.clientId
                    || currentDocument.branchId !== params.branchId
                    || (
                        currentDocument.serviceRecordCaseId != null
                        && !lockedWriteSet?.caseIds.includes(currentDocument.serviceRecordCaseId)
                    )
                )
            ) {
                return false;
            }

            if (
                completeLockSurface
                && !await this.isCurrentContractWriteTarget(tx, {
                    branchId: params.branchId,
                    clientId: params.clientId,
                    documentId: params.documentId,
                    currentDocument: {
                        id: currentDocument.id,
                        clientId: currentDocument.clientId ?? null,
                        branchId: currentDocument.branchId ?? null,
                        serviceRecordCaseId: currentDocument.serviceRecordCaseId ?? null,
                        revisionId: currentDocument.revisionId ?? null,
                    },
                    caseIds: lockedWriteSet?.caseIds ?? [],
                })
            ) return false;

            await this.syncEndDateFromContractInTransaction(params, tx, calendar);
            return true;
        });
    }

    /**
     * Validate the mirrored contract's live pointer and revision identity after
     * the common client/case/document lock set has been acquired. A mirror may
     * still be fully ready while it is an older document, so mirror generation
     * freshness alone is not sufficient to authorize a client or period write.
     */
    private async isCurrentContractWriteTarget(
        tx: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            documentId: string;
            currentDocument: {
                id: number;
                clientId: number | null;
                branchId: string | null;
                serviceRecordCaseId: string | null;
                revisionId: string | null;
            };
            caseIds: string[];
        },
    ): Promise<boolean> {
        const clients = await tx.$queryRaw<Array<{
            id: number;
            eDocId: string | null;
            branchId: string | null;
        }>>(Prisma.sql`
            SELECT id,
                   e_doc_id AS "eDocId",
                   branch_id AS "branchId"
            FROM client
            WHERE id = ${params.clientId}
              AND branch_id = ${params.branchId}::uuid
            FOR UPDATE
        `);
        if (
            clients.length !== 1
            || clients[0]?.id !== params.clientId
            || clients[0].branchId !== params.branchId
            || clients[0].eDocId !== params.documentId
        ) return false;

        const revisionCases = await tx.$queryRaw<Array<{
            id: string;
            branchId: string;
            clientId: number | null;
            currentRevisionId: string | null;
            currentUsableRevisionId: string | null;
            currentUsableDocumentVersion: number | null;
        }>>(Prisma.sql`
            SELECT id,
                   branch_id AS "branchId",
                   client_id AS "clientId",
                   current_revision_id AS "currentRevisionId",
                   current_usable_revision_id AS "currentUsableRevisionId",
                   current_usable_document_version AS "currentUsableDocumentVersion"
            FROM service_record_case
            WHERE branch_id = ${params.branchId}::uuid
              AND client_id = ${params.clientId}
              ${params.currentDocument.serviceRecordCaseId
                ? Prisma.sql`AND id = ${params.currentDocument.serviceRecordCaseId}::uuid`
                : Prisma.empty}
            FOR UPDATE
        `);
        if (params.caseIds.length > 1) {
            // Maternal contracts are household-wide. A document carrying a
            // case/revision is never allowed to drive a sibling period write.
            return params.currentDocument.serviceRecordCaseId === null
                && params.currentDocument.revisionId === null
                && revisionCases.length === params.caseIds.length
                && revisionCases.every((record) => record.currentRevisionId === null
                    && record.currentUsableRevisionId === null && record.currentUsableDocumentVersion === null);
        }
        const ownerCase = revisionCases[0];
        if (ownerCase) {
            if (
                ownerCase.branchId !== params.branchId
                || ownerCase.clientId !== params.clientId
                || (
                    params.currentDocument.serviceRecordCaseId !== null
                    && ownerCase.id !== params.currentDocument.serviceRecordCaseId
                )
                || (
                    params.caseIds.length !== 1
                    || ownerCase.id !== params.caseIds[0]
                )
            ) return false;
            if (params.currentDocument.revisionId === null) {
                return ownerCase.currentRevisionId === null
                    && ownerCase.currentUsableRevisionId === null
                    && ownerCase.currentUsableDocumentVersion === null;
            }
            return ownerCase.id === params.currentDocument.serviceRecordCaseId
                && ownerCase.currentRevisionId === params.currentDocument.revisionId;
        }
        return params.currentDocument.revisionId === null
            && params.currentDocument.serviceRecordCaseId === null
            && params.caseIds.length === 0;
    }

    async findSnapshotChunkBranchForDocument(documentId: string): Promise<string | null> {
        const chunk = await this.prisma.service_record_snapshot_chunk.findUnique({
            where: { eformsignDocumentId: documentId },
            select: { branchId: true },
        });
        return chunk?.branchId ?? null;
    }

    async evaluateInitialSnapshotTerminalOutcome(params: InitialSnapshotTerminalOutcomeInput): Promise<boolean> {
        return this.prisma.$transaction(tx =>
            ServiceRecordLifecycleService.evaluateInitialSnapshotTerminalOutcomeInTransaction(params, tx));
    }

    /** The caller must hold case before state/chunk/doc locks. This method never opens a nested transaction. */
    static async evaluateInitialSnapshotTerminalOutcomeInTransaction(
        params: InitialSnapshotTerminalOutcomeInput,
        tx: Prisma.TransactionClient,
    ): Promise<boolean> {
        // The chunk retains its document FK, revision and version after the document is scrubbed.
        const scopes = await tx.$queryRaw<Array<{ caseId: string; revisionId: string; snapshotVersion: number }>>(Prisma.sql`
            SELECT service_record_case_id AS "caseId", revision_id AS "revisionId", snapshot_version AS "snapshotVersion"
            FROM service_record_snapshot_chunk
            WHERE branch_id = ${params.branchId}::uuid AND document_id = ${params.documentId}
              AND revision_id IS NOT NULL
        `);
        const scope = scopes[0];
        if (scopes.length !== 1 || !scope) return false;
        const cases = await tx.$queryRaw<LockedServiceRecordCaseRevisionState[]>(Prisma.sql`
            SELECT id, client_id AS "clientId", version, current_revision_id AS "currentRevisionId",
                current_usable_revision_id AS "currentUsableRevisionId",
                current_usable_document_version AS "currentUsableDocumentVersion"
            FROM service_record_case
            WHERE id = ${scope.caseId}::uuid AND branch_id = ${params.branchId}::uuid
              AND current_revision_id = ${scope.revisionId}::uuid
              AND status IN ('READY_TO_FINALIZE', 'FINALIZING', 'DOCUMENTS_CREATED', 'FINALIZATION_FAILED', 'COMPLETED')
            FOR UPDATE
        `);
        const owner = cases[0];
        if (!owner || owner.currentRevisionId !== scope.revisionId) return false;
        const states = await tx.$queryRaw<Array<{
            id: string; generation: string; version: number; workflowScope: Prisma.JsonValue;
            status: string; step: string; lastErrorCode: string | null;
        }>>(Prisma.sql`
            SELECT id, generation, version, workflow_scope AS "workflowScope", status, step, last_error_code AS "lastErrorCode"
            FROM service_record_revision_document_state AS state
            WHERE branch_id = ${params.branchId}::uuid AND client_id = ${owner.clientId}
              AND service_record_case_id = ${owner.id}::uuid AND revision_id = ${scope.revisionId}::uuid
              AND document_version = ${scope.snapshotVersion} AND operation = 'record_snapshot'
              AND ${newestInitialFinalizationStateSql("state")}
            FOR UPDATE
        `);
        const eligible = states.filter(state => isInitialFinalizationWorkflowScopeForRevision(
            state.workflowScope, scope.revisionId,
        ));
        if (eligible.length !== 1) return false;
        const state = eligible[0]!;
        // 삭제로 이미 완료된 기록 전체를 되돌리지 않는다.
        if (state.status === "completed") return false;
        const chunks = await tx.$queryRaw<Array<{ documentId: string | null; chunkIndex: number; chunkCount: number }>>(Prisma.sql`
            SELECT document_id AS "documentId", chunk_index AS "chunkIndex", chunk_count AS "chunkCount"
            FROM service_record_snapshot_chunk
            WHERE branch_id = ${params.branchId}::uuid AND service_record_case_id = ${owner.id}::uuid
              AND revision_id = ${scope.revisionId}::uuid AND snapshot_version = ${scope.snapshotVersion}
            ORDER BY chunk_index, id FOR UPDATE
        `);
        if (!chunks.some(chunk => chunk.documentId === params.documentId)) return false;
        const documents = await tx.$queryRaw<Array<{
            documentId: string; statusType: string; voidedAt: Date | null; tombstoneEvaluated: boolean; tombstoneSettled: boolean;
        }>>(Prisma.sql`
            SELECT doc.document_id AS "documentId", doc.status_type AS "statusType", doc.voided_at AS "voidedAt",
                ${initialTombstoneEvaluatedSql} AS "tombstoneEvaluated",
                ${params.fromSweep ? initialTombstoneSettledSql : Prisma.sql`true`} AS "tombstoneSettled"
            FROM service_record_snapshot_chunk AS chunk
            JOIN eformsign_doc AS doc ON doc.document_id = chunk.document_id
            WHERE chunk.branch_id = ${params.branchId}::uuid AND chunk.service_record_case_id = ${owner.id}::uuid
              AND chunk.revision_id = ${scope.revisionId}::uuid AND chunk.snapshot_version = ${scope.snapshotVersion}
              AND doc.branch_id = chunk.branch_id
              AND (doc.revision_id = chunk.revision_id
                   OR (doc.revision_id IS NULL AND ${eformsignStatusMatchesSql(Prisma.sql`doc.status_type`, EFORMSIGN_TOMBSTONE_STATUSES)}))
            ORDER BY doc.id
            FOR UPDATE OF doc
        `);
        const document = documents.find(doc => doc.documentId === params.documentId);
        if (!document) return false;
        const statusType = normalizeEformsignStatusCode(document.statusType);
        const deleted = statusType === EFORMSIGN_TOMBSTONE_STATUS;
        if (!deleted && document.voidedAt === null && !EFORMSIGN_REJECTED_STATUS_CODES.has(statusType)) return false;
        const capturedStatuses = new Map(params.deletedDocuments?.map(doc => [doc.documentId, normalizeEformsignStatusCode(doc.statusType)]));
        const tombstones = documents.filter(doc => normalizeEformsignStatusCode(doc.statusType) === EFORMSIGN_TOMBSTONE_STATUS);
        const completedDeletion = tombstones.some(doc =>
            EFORMSIGN_COMPLETED_STATUS_CODES.has(capturedStatuses.get(doc.documentId) ?? ""));
        const safelyCaptured = tombstones.filter(doc => {
            const code = capturedStatuses.get(doc.documentId);
            return code !== undefined && code !== EFORMSIGN_TOMBSTONE_STATUS
                && !EFORMSIGN_COMPLETED_STATUS_CODES.has(code)
                && (EFORMSIGN_REJECTED_STATUS_CODES.has(code) || EFORMSIGN_IN_PROGRESS_STATUS_CODES.has(code)
                    || EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES.has(code) || code === "090");
        });
        const unknownDeletion = (doc: typeof document) => !doc.tombstoneEvaluated
            && !safelyCaptured.some(captured => captured.documentId === doc.documentId);
        // N9-1: 완료 chunk 삭제 증거는 미연결 chunk나 이전 부재 판정보다 우선한다.
        if (state.lastErrorCode === SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED) return false;
        const wasFailed = state.status === "failed";
        // A sibling can be purged after candidate discovery. Check again with the document rows locked.
        if (params.fromSweep && tombstones.some(doc => !doc.tombstoneSettled
            && (doc === document || (!wasFailed && unknownDeletion(doc))))) return false;
        if (!completedDeletion) {
            if (wasFailed) {
                if (!deleted || !INITIAL_TERMINAL_PROVIDER_FAILURE_CODES.has(state.lastErrorCode ?? "")) return false;
            } else if (state.status === "manual_review") {
                const indexes = new Set(chunks.map(chunk => chunk.chunkIndex));
                const allLinked = chunks.length > 0 && indexes.size === chunks.length
                    && chunks.every(chunk => chunk.documentId !== null && chunk.chunkCount === chunks.length
                        && chunk.chunkIndex >= 1 && chunk.chunkIndex <= chunks.length);
                if (state.lastErrorCode !== "JOB_CANCELLED_AFTER_DISPATCH" || !allLinked) return false;
            } else if (state.status !== "processing" || state.step !== "documents_created") {
                // 발송 중 삭제된 chunk는 documents_created 전환 트랜잭션에서 다시 평가한다.
                return false;
            }
        } else if (!["processing", "manual_review", "failed"].includes(state.status)) return false;
        // Sweep ordering must not turn an unknown deleted sibling into a ready provider-failure code.
        const errorCode = completedDeletion ? SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED
            : (wasFailed ? unknownDeletion(document) : tombstones.some(unknownDeletion))
                ? SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN
            : wasFailed ? state.lastErrorCode
            : !deleted && document.voidedAt !== null ? "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED"
            : "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED";
        const recordEvaluatedTombstones = async (): Promise<number> => {
            const newlyEvaluated = safelyCaptured.filter(doc => !doc.tombstoneEvaluated);
            if (newlyEvaluated.length === 0) return 0;
            return tx.$executeRaw(Prisma.sql`
                UPDATE service_record_snapshot_chunk AS chunk
                SET last_error = ${initialTombstoneEvaluationRecordSql}, updated_at = now()
                FROM eformsign_doc AS doc
                WHERE chunk.branch_id = ${params.branchId}::uuid AND chunk.service_record_case_id = ${owner.id}::uuid
                  AND chunk.revision_id = ${scope.revisionId}::uuid AND chunk.snapshot_version = ${scope.snapshotVersion}
                  AND doc.branch_id = chunk.branch_id AND doc.document_id = chunk.document_id
                  AND doc.document_id IN (${Prisma.join(newlyEvaluated.map(doc => doc.documentId))})
            `);
        };
        if (wasFailed && errorCode === state.lastErrorCode) return (await recordEvaluatedTombstones()) > 0;
        const changed = await tx.$executeRaw(Prisma.sql`
            UPDATE service_record_revision_document_state
            SET status = 'failed', step = 'failed', last_error_code = ${errorCode}, next_attempt_at = NULL,
                version = version + 1, updated_at = now()
            WHERE id = ${state.id}::uuid AND generation = ${state.generation} AND version = ${state.version}
        `);
        if (changed !== 1) throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        const caseChanged = await tx.$executeRaw(Prisma.sql`
            UPDATE service_record_case
            SET status = 'FINALIZATION_FAILED', last_error = ${errorCode}, documents_completed_at = NULL,
                current_usable_revision_id = NULL, current_usable_document_version = NULL, next_attempt_at = NULL,
                version = version + 1, updated_at = now()
            WHERE id = ${owner.id}::uuid AND branch_id = ${params.branchId}::uuid
              AND current_revision_id = ${scope.revisionId}::uuid AND version = ${owner.version}
              AND status IN ('READY_TO_FINALIZE', 'FINALIZING', 'DOCUMENTS_CREATED', 'FINALIZATION_FAILED', 'COMPLETED')
        `);
        if (caseChanged !== 1) throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        if (INITIAL_TERMINAL_PROVIDER_FAILURE_CODES.has(errorCode ?? "")) await recordEvaluatedTombstones();
        return true;
    }

    async healInitialSnapshotTerminalOutcomes(options: { branchId?: string; shouldContinue?: () => boolean } = {}): Promise<number> {
        const tombstoneSql = eformsignStatusMatchesSql(Prisma.sql`doc.status_type`, EFORMSIGN_TOMBSTONE_STATUSES);
        const candidates = await this.prisma.$queryRaw<Array<{ branchId: string; documentId: string }>>(Prisma.sql`
            SELECT DISTINCT chunk.branch_id AS "branchId", chunk.document_id AS "documentId"
            FROM service_record_snapshot_chunk AS chunk
            JOIN eformsign_doc AS doc ON doc.document_id = chunk.document_id AND doc.branch_id = chunk.branch_id
            JOIN service_record_revision_document_state AS state
              ON state.service_record_case_id = chunk.service_record_case_id AND state.branch_id = chunk.branch_id
              AND state.revision_id = chunk.revision_id AND state.document_version = chunk.snapshot_version
            JOIN service_record_case AS owner ON owner.id = chunk.service_record_case_id
              AND owner.current_revision_id = chunk.revision_id
            WHERE state.operation = 'record_snapshot'
              AND state.workflow_scope->>'generationKind' = 'INITIAL_FINALIZATION'
              AND ${newestInitialFinalizationStateSql("state")}
              AND (NOT ${tombstoneSql} OR ${initialTombstoneSettledSql})
              AND (
                (state.status IN ('processing', 'manual_review') AND
                  (${eformsignStatusMatchesSql(Prisma.sql`doc.status_type`, EFORMSIGN_REJECTED_STATUS_CODES)} OR doc.voided_at IS NOT NULL))
                OR (state.status = 'failed' AND state.last_error_code IN (${Prisma.join([...INITIAL_TERMINAL_PROVIDER_FAILURE_CODES])})
                  AND ${tombstoneSql}
                  AND NOT ${initialTombstoneEvaluatedSql})
              )
              ${options.branchId ? Prisma.sql`AND chunk.branch_id = ${options.branchId}::uuid` : Prisma.empty}
            ORDER BY "branchId", "documentId"
        `);
        let healed = 0;
        for (const candidate of candidates) {
            if (options.shouldContinue && !options.shouldContinue()) break;
            if (await this.evaluateInitialSnapshotTerminalOutcome({ ...candidate, fromSweep: true })) healed += 1;
        }
        return healed;
    }

    async failInitialServiceRecordSnapshotInTransaction(
        params: { branchId: string; documentId: string },
        tx: Prisma.TransactionClient,
    ): Promise<boolean> {
        const trigger = await tx.eformsign_doc.findFirst({
            where: {
                branchId: params.branchId, documentId: params.documentId,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                permanentPurgeRequestedAt: null,
            },
            select: { serviceRecordCaseId: true, revisionId: true, snapshotVersion: true, statusType: true, voidedAt: true },
        });
        if (!trigger?.serviceRecordCaseId || !trigger.revisionId || trigger.snapshotVersion === null) return false;
        if (trigger.voidedAt === null && !EFORMSIGN_REJECTED_STATUS_CODES.has(trigger.statusType)) return false;
        const revisionId = trigger.revisionId;

        // Lock in the same order as completion: case, state, then snapshot chunks/documents.
        const cases = await tx.$queryRaw<LockedServiceRecordCaseRevisionState[]>(Prisma.sql`
            SELECT id, client_id AS "clientId", version, current_revision_id AS "currentRevisionId",
                current_usable_revision_id AS "currentUsableRevisionId",
                current_usable_document_version AS "currentUsableDocumentVersion"
            FROM service_record_case
            WHERE id = ${trigger.serviceRecordCaseId}::uuid AND branch_id = ${params.branchId}::uuid
              AND current_revision_id = ${trigger.revisionId}::uuid
              AND status IN ('DOCUMENTS_CREATED', 'COMPLETED')
            FOR UPDATE
        `);
        const owner = cases[0];
        if (!owner || owner.currentRevisionId !== trigger.revisionId
            || (owner.currentUsableRevisionId !== null
                && (owner.currentUsableRevisionId !== trigger.revisionId
                    || owner.currentUsableDocumentVersion !== trigger.snapshotVersion))) return false;

        const states = await tx.$queryRaw<Array<{
            id: string; generation: string; version: number; workflowScope: Prisma.JsonValue;
            status: string; step: string;
        }>>(Prisma.sql`
            SELECT id, generation, version, workflow_scope AS "workflowScope", status, step
            FROM service_record_revision_document_state AS state
            WHERE branch_id = ${params.branchId}::uuid AND client_id = ${owner.clientId}
              AND service_record_case_id = ${owner.id}::uuid AND revision_id = ${trigger.revisionId}::uuid
              AND document_version = ${trigger.snapshotVersion} AND operation = 'record_snapshot'
              AND ${newestInitialFinalizationStateSql("state")}
            FOR UPDATE
        `);
        const eligible = states.filter((state) =>
            ((state.status === "processing" && state.step === "documents_created")
                || (state.status === "completed" && state.step === "completed"))
            && isInitialFinalizationWorkflowScopeForRevision(state.workflowScope, revisionId));
        if (eligible.length !== 1) return false;
        const state = eligible[0];
        if (!state) return false;

        // INITIAL stores document IDs on its persisted chunks, not target_document_id.
        const documents = await tx.$queryRaw<Array<{ statusType: string; voidedAt: Date | null }>>(Prisma.sql`
            SELECT doc.status_type AS "statusType", doc.voided_at AS "voidedAt"
            FROM service_record_snapshot_chunk AS chunk
            JOIN eformsign_doc AS doc ON doc.document_id = chunk.document_id
            WHERE chunk.branch_id = ${params.branchId}::uuid
              AND chunk.service_record_case_id = ${owner.id}::uuid
              AND chunk.revision_id = ${trigger.revisionId}::uuid
              AND chunk.snapshot_version = ${trigger.snapshotVersion} AND chunk.status = 'CREATED'
              AND chunk.document_id = ${params.documentId}
              AND doc.branch_id = ${params.branchId}::uuid AND doc.client_id = ${owner.clientId}
              AND doc.service_record_case_id = chunk.service_record_case_id AND doc.revision_id = chunk.revision_id
              AND doc.snapshot_version = chunk.snapshot_version AND doc.snapshot_chunk_index = chunk.chunk_index
              AND doc.document_kind = ${EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT}
              AND doc.status_type = ${trigger.statusType}
            FOR UPDATE OF chunk, doc
        `);
        const document = documents[0];
        if (documents.length !== 1 || !document
            || (trigger.voidedAt !== null && document.voidedAt === null)
            || (document.voidedAt === null && !EFORMSIGN_REJECTED_STATUS_CODES.has(document.statusType))) return false;
        const errorCode = document.voidedAt !== null
            ? "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED"
            : "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED";
        const changed = await tx.$executeRaw(Prisma.sql`
            UPDATE service_record_revision_document_state
            SET status = 'failed', step = 'failed', last_error_code = ${errorCode}, next_attempt_at = NULL,
                version = version + 1, updated_at = now()
            WHERE id = ${state.id}::uuid AND generation = ${state.generation} AND version = ${state.version}
        `);
        if (changed !== 1) throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        const caseChanged = await tx.$executeRaw(Prisma.sql`
            UPDATE service_record_case
            SET status = 'FINALIZATION_FAILED', last_error = ${errorCode}, documents_completed_at = NULL,
                current_usable_revision_id = NULL, current_usable_document_version = NULL, next_attempt_at = NULL,
                version = version + 1, updated_at = now()
            WHERE id = ${owner.id}::uuid AND branch_id = ${params.branchId}::uuid
              AND current_revision_id = ${trigger.revisionId}::uuid AND version = ${owner.version}
              AND status IN ('DOCUMENTS_CREATED', 'COMPLETED')
        `);
        if (caseChanged !== 1) throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        return true;
    }

    async completeServiceRecordSnapshotIfReady(params: {
        branchId: string;
        documentId: string;
        mirrorVersion?: {
            detailSourceUpdatedDate: Date;
            detailSyncedAt: Date;
        };
    }): Promise<boolean> {
        return this.prisma.$transaction(async (tx) =>
            this.completeServiceRecordSnapshotIfReadyInTransaction(params, tx));
    }

    private async completeServiceRecordSnapshotIfReadyInTransaction(
        params: {
            branchId: string;
            documentId: string;
            mirrorVersion?: {
                detailSourceUpdatedDate: Date;
                detailSyncedAt: Date;
            };
        },
        tx: Prisma.TransactionClient,
    ): Promise<boolean> {
        const trigger = await tx.eformsign_doc.findFirst({
            where: {
                branchId: params.branchId,
                documentId: params.documentId,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                serviceRecordCaseId: { not: null },
            },
            select: {
                serviceRecordCaseId: true,
                revisionId: true,
                snapshotVersion: true,
            },
        });
        if (!trigger?.serviceRecordCaseId) return false;

        const cases = await tx.$queryRaw<LockedServiceRecordCaseRevisionState[]>(Prisma.sql`
            SELECT
                id, client_id AS "clientId", version,
                current_revision_id AS "currentRevisionId",
                current_usable_revision_id AS "currentUsableRevisionId",
                current_usable_document_version AS "currentUsableDocumentVersion"
            FROM service_record_case
            WHERE id = ${trigger.serviceRecordCaseId}::uuid
              AND branch_id = ${params.branchId}::uuid
              AND status = ${SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED}
            FOR UPDATE
        `);
        if (cases.length !== 1) return false;
        const lockedCase = cases[0];
        if (!lockedCase) return false;
        const triggerRevisionId = normalizeRevisionId(trigger.revisionId);
        const triggerSnapshotVersion = normalizeSnapshotVersion(trigger.snapshotVersion);
        const currentRevisionId = normalizeRevisionId(lockedCase.currentRevisionId);
        const currentUsableRevisionId = normalizeRevisionId(lockedCase.currentUsableRevisionId);
        const currentUsableDocumentVersion = normalizeSnapshotVersion(lockedCase.currentUsableDocumentVersion);

        let initialState: { id: string; generation: string; version: number } | null = null;
        if (triggerRevisionId === null) {
            if (!isLegacyCaseRevisionState(lockedCase)) return false;
        } else {
            if (currentRevisionId !== triggerRevisionId || triggerSnapshotVersion === null
                || !Number.isInteger(triggerSnapshotVersion) || triggerSnapshotVersion < 1) return false;
            const pointerMatches = currentUsableRevisionId === triggerRevisionId
                && currentUsableDocumentVersion === triggerSnapshotVersion;
            if (!pointerMatches) {
                const states = await tx.$queryRaw<Array<{
                    id: string; generation: string; version: number; workflowScope: Prisma.JsonValue;
                    status: string; step: string;
                }>>(Prisma.sql`
                    SELECT id, generation, version, workflow_scope AS "workflowScope", status, step
                    FROM service_record_revision_document_state AS state
                    WHERE branch_id = ${params.branchId}::uuid
                      AND client_id = ${lockedCase.clientId}
                      AND service_record_case_id = ${trigger.serviceRecordCaseId}::uuid
                      AND revision_id = ${triggerRevisionId}::uuid
                      AND document_version = ${triggerSnapshotVersion}
                      AND operation = 'record_snapshot'
                      AND ${newestInitialFinalizationStateSql("state")}
                    FOR UPDATE
                `);
                const matching = states.filter((state) => state.status === "processing"
                    && state.step === "documents_created"
                    && isInitialFinalizationWorkflowScopeForRevision(state.workflowScope, triggerRevisionId));
                if (matching.length !== 1) return false;
                initialState = matching[0]!;
            }
        }

        const snapshots = await tx.$queryRaw<LockedServiceRecordSnapshot[]>(Prisma.sql`
            SELECT
                id,
                document_id AS "documentId",
                branch_id AS "branchId",
                document_kind AS "documentKind",
                revision_id AS "revisionId",
                snapshot_version AS "snapshotVersion",
                status_type AS "statusType",
                detail_payload AS "detailPayload",
                detail_source_updated_date AS "detailSourceUpdatedDate",
                detail_synced_at AS "detailSyncedAt",
                sync_status AS "syncStatus",
                permanent_purge_requested_at AS "permanentPurgeRequestedAt",
                EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS document_file
                    WHERE document_file.eformsign_doc_id = eformsign_doc.id
                      AND document_file.file_type = 'document'
                      AND document_file.source_updated_date
                        = eformsign_doc.detail_source_updated_date
                ) AS "hasCurrentDocumentPdf",
                EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS audit_trail_file
                    WHERE audit_trail_file.eformsign_doc_id = eformsign_doc.id
                      AND audit_trail_file.file_type = 'audit_trail'
                      AND audit_trail_file.source_updated_date
                        = eformsign_doc.detail_source_updated_date
                ) AS "hasCurrentAuditTrailPdf"
            FROM eformsign_doc
            WHERE branch_id = ${params.branchId}::uuid
              AND service_record_case_id = ${trigger.serviceRecordCaseId}::uuid
              AND document_kind = ${EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT}
              ${trigger.revisionId ? Prisma.sql`AND NOT EXISTS (
                  SELECT 1 FROM service_record_revision_document_state AS newest_state
                  WHERE newest_state.branch_id = ${params.branchId}::uuid
                    AND newest_state.service_record_case_id = ${trigger.serviceRecordCaseId}::uuid
                    AND newest_state.revision_id = ${trigger.revisionId ?? null}::uuid
                    AND ${initialFinalizationStateSql("newest_state")}
                    AND ${newestInitialFinalizationStateSql("newest_state")}
                    AND newest_state.document_version IS DISTINCT FROM ${trigger.snapshotVersion ?? null}::int
              )` : Prisma.empty}
            ORDER BY id ASC
            FOR UPDATE
        `);
        const eligibleSnapshots = triggerRevisionId === null
            ? snapshots.filter((snapshot) => normalizeRevisionId(snapshot.revisionId) === null)
            : snapshots.filter((snapshot) =>
                normalizeRevisionId(snapshot.revisionId) === triggerRevisionId
                && normalizeSnapshotVersion(snapshot.snapshotVersion) === triggerSnapshotVersion);
        if (triggerRevisionId === null && eligibleSnapshots.length !== snapshots.length) return false;
        const lockedTrigger = eligibleSnapshots.find((snapshot) =>
            snapshot.documentId === params.documentId
            && snapshot.branchId === params.branchId
            && snapshot.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
        );
        if (
            eligibleSnapshots.length === 0
            || !lockedTrigger
            || !isCurrentMirrorSnapshotVersion(lockedTrigger, params.mirrorVersion)
            || eligibleSnapshots.some((snapshot) =>
                !isReadyCurrentSnapshot(snapshot)
                || !EFORMSIGN_COMPLETED_STATUS_CODES.has(snapshot.statusType))
        ) return false;

        if (initialState) {
            const pointer = await tx.$executeRaw(Prisma.sql`
                UPDATE service_record_case
                SET current_usable_revision_id = ${triggerRevisionId}::uuid,
                    current_usable_document_version = ${triggerSnapshotVersion},
                    version = version + 1, updated_at = now()
                WHERE id = ${trigger.serviceRecordCaseId}::uuid AND branch_id = ${params.branchId}::uuid
                  AND client_id = ${lockedCase.clientId} AND current_revision_id = ${triggerRevisionId}::uuid
                  AND version = ${lockedCase.version} AND status = 'DOCUMENTS_CREATED'
                  AND (current_usable_revision_id IS NULL
                    OR (current_usable_revision_id = ${triggerRevisionId}::uuid
                        AND current_usable_document_version = ${triggerSnapshotVersion})
                    OR (current_usable_revision_id IS NOT NULL AND current_usable_revision_id <> ${triggerRevisionId}::uuid
                        AND current_usable_document_version IS NOT NULL
                        AND current_usable_document_version < ${triggerSnapshotVersion}))
            `);
            if (pointer !== 1) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_STALE" });
            const stateCompleted = await tx.$executeRaw(Prisma.sql`
                UPDATE service_record_revision_document_state
                SET status = 'completed', step = 'completed', last_error_code = NULL,
                    version = version + 1, updated_at = now()
                WHERE id = ${initialState.id}::uuid AND generation = ${initialState.generation}
                  AND version = ${initialState.version} AND status = 'processing' AND step = 'documents_created'
            `);
            if (stateCompleted !== 1) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_STALE" });
        }
        const completed = await tx.service_record_case.updateMany({
            where: {
                id: trigger.serviceRecordCaseId,
                branchId: params.branchId,
                status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.COMPLETED,
                documentsCompletedAt: new Date(),
                version: { increment: 1 },
            },
        });
        if (initialState && completed.count !== 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_STALE" });
        }
        return completed.count === 1;
    }

    private async syncEndDateFromContractInTransaction(
        params: {
            branchId: string;
            clientId: number;
            endDate: Date;
        },
        tx: Prisma.TransactionClient,
        calendar: KrBusinessDayCalendar,
    ): Promise<void> {
        if (this.hasCompleteServiceRecordWriteLockSurface(tx)) {
            const locked = await this.lockClientOwnedWriteSet(tx, {
                branchId: params.branchId,
                clientId: params.clientId,
            });
            if (!locked) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
        }
        await this.validatePeriodChange({
            branchId: params.branchId,
            clientId: params.clientId,
            endDate: params.endDate,
        }, tx);

        // A few legacy unit-test transaction doubles
        // do not expose findUnique; those retain the historical
        // end-date-only update shape.
        let duration: number | null | undefined;
        // The calendar handed on to `ensureForClient` carries the locked
        // client's service-day policy (it re-applies the policy itself).
        let clientCalendar = calendar;
        if (typeof tx.client.findUnique === "function") {
            const currentClient = await tx.client.findUnique({
                where: { id: params.clientId },
                select: {
                    startDate: true,
                    duration: true,
                    allowSaturdayService: true,
                    allowSundayService: true,
                    allowHolidayService: true,
                },
            });
            const cases = await tx.service_record_case.findMany({
                where: { branchId: params.branchId, clientId: params.clientId },
                select: { id: true },
                take: 1,
            });
            clientCalendar = withClientServiceDays(calendar, currentClient);
            // A null client duration on a case that already has persisted
            // service-record state is legacy evidence, not permission to
            // backfill the nominal voucher from a later period edit. Keep it
            // visible for preview/repair instead of changing billing facts.
            // The no-case path retains the historical initialization needed
            // when a contract completes a client period for the first time.
            if (currentClient && currentClient.duration === null && cases.length === 0) {
                if (!currentClient.startDate) {
                    duration = null;
                } else {
                    const derived = deriveInitialSessionCount({
                        startDate: currentClient.startDate,
                        endDate: params.endDate,
                        calendar: clientCalendar,
                    });
                    if (derived === null) {
                        throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    }
                    duration = derived;
                }
            }
        }

        const updated = await tx.client.updateMany({
            where: {
                id: params.clientId,
                OR: [
                    { branchId: params.branchId },
                    { branchId: null },
                ],
            },
            data: {
                endDate: params.endDate,
                ...(duration === undefined ? {} : { duration }),
            },
        });
        if (updated.count !== 1) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        await this.ensureAllForClient(params.clientId, tx, clientCalendar);
    }

    private hasCompleteServiceRecordWriteLockSurface(
        tx: Prisma.TransactionClient,
    ): boolean {
        const scheduleDelegate = tx.employee_schedule as unknown as {
            findMany?: unknown;
        } | undefined;
        const caseDelegate = tx.service_record_case as unknown as {
            findUnique?: unknown;
        } | undefined;
        return typeof tx.$queryRaw === "function"
            && typeof scheduleDelegate?.findMany === "function"
            && typeof caseDelegate?.findUnique === "function";
    }

    private async lockClientOwnedWriteSet(
        tx: Prisma.TransactionClient,
        params: { branchId: string; clientId: number; documentRowId?: number },
    ): Promise<{
        scheduleIds: number[];
        employeeIds: number[];
        caseIds: string[];
    } | null> {
        const client = await tx.client.findUnique({
            where: { id: params.clientId },
            select: { id: true, branchId: true },
        });
        if (!client || (client.branchId !== null && client.branchId !== params.branchId)) {
            return null;
        }
        const schedules = await tx.employee_schedule.findMany({
            where: { branchId: params.branchId, clientId: params.clientId },
            select: {
                id: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
            },
            orderBy: { id: "asc" },
        });
        const result = await lockServiceRecordWriteSet(tx, {
            branchId: params.branchId,
            clientId: params.clientId,
            expectedScheduleIds: schedules.map((schedule) => schedule.id),
            scheduleIds: schedules.map((schedule) => schedule.id),
            employeeIds: schedules.flatMap((schedule) => [
                schedule.primaryEmployeeId,
                schedule.secondaryEmployeeId,
            ]),
            documentIds: params.documentRowId === undefined ? [] : [params.documentRowId],
        });
        const rereadClient = await tx.client.findUnique({
            where: { id: params.clientId },
            select: { id: true, branchId: true },
        });
        if (!rereadClient || (rereadClient.branchId !== null && rereadClient.branchId !== params.branchId)) {
            throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
        }
        const cases = await tx.service_record_case.findMany({
            where: { branchId: params.branchId, clientId: params.clientId },
            select: { id: true },
        });
        return { ...result, caseIds: cases.map(({ id }) => id) };
    }

    async recompute(
        serviceRecordCaseId: string,
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
        options?: { preserveVersion: boolean },
    ) {
        // A root recompute is itself a business write. Discover only the
        // owning identifiers before opening the transaction, then acquire the
        // complete client -> employees -> case -> schedules/assignments/days
        // set before rereading the case that supplies the derived status. A
        // caller-owned transaction has already established (or deliberately
        // owns) that order, so it must never start a nested root transaction.
        if (!tx && typeof this.prisma.$transaction === "function") {
            const discovered = await this.prisma.service_record_case.findUnique({
                where: { id: serviceRecordCaseId },
                select: { id: true, branchId: true, clientId: true, status: true },
            });
            if (!discovered) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

            // Finalization/termination states are terminal for lifecycle
            // recompute and contain no later client/employee write. Returning
            // the current snapshot keeps those paths read-only and avoids
            // taking a client lock after a terminal case has been claimed.
            if (
                IMMUTABLE_FINALIZATION_STATUSES.has(discovered.status)
                || discovered.status === SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED
                || discovered.status === SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED
            ) {
                return this.recomputeInTransaction(serviceRecordCaseId, this.prisma);
            }

            // Saved computation: the persisted N depends on the branch calendar,
            // so read it fresh before the owning transaction opens.
            const rootCalendar = calendar ?? (typeof discovered.branchId === "string"
                ? await this.holidayCalendar.forBranch(discovered.branchId, { fresh: true })
                : undefined);

            // A legacy case can outlive its client because the client relation
            // is nullable. It still needs an owning transaction before this
            // recompute writes. There is no client row to serialize in that
            // shape, so lock the branch-scoped case itself and keep the path
            // case-only. Narrow doubles without a usable branch retain their
            // direct seam because they cannot represent this database state.
            const discoveredClientId = discovered.clientId;
            if (typeof discoveredClientId !== "number") {
                if (typeof discovered.branchId === "string") {
                    return this.prisma.$transaction(async (transaction) => {
                        const caseLocked = await lockServiceRecordCaseForWrite(
                            transaction,
                            discovered.branchId,
                            serviceRecordCaseId,
                        );
                        if (typeof transaction.$queryRaw === "function" && !caseLocked) {
                            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                        }
                        return this.recomputeInTransaction(serviceRecordCaseId, transaction, rootCalendar, options);
                    });
                }
                return this.recomputeInTransaction(serviceRecordCaseId, this.prisma, rootCalendar, options);
            }

            return this.prisma.$transaction(async (transaction) => {
                await lockServiceRecordWriteSet(transaction, {
                    branchId: discovered.branchId,
                    clientId: discoveredClientId,
                    caseId: serviceRecordCaseId,
                });
                return this.recomputeInTransaction(serviceRecordCaseId, transaction, rootCalendar, options);
            });
        }

        return this.recomputeInTransaction(serviceRecordCaseId, tx ?? this.prisma, calendar, options);
    }

    /**
     * `calendar` is the branch calendar a root caller already read before opening
     * its transaction; a caller-owned transaction has no such seam, so it is
     * resolved from the loaded case's branch below. Never a built-in fallback.
     */
    private async recomputeInTransaction(
        serviceRecordCaseId: string,
        db: DbClient,
        calendar?: KrBusinessDayCalendar,
        options?: { preserveVersion: boolean },
    ) {
        const loaded = await db.service_record_case.findUnique({
            where: { id: serviceRecordCaseId },
            include: {
                assignments: { include: { schedule: { select: { replaced: true } } } },
                days: {
                    select: {
                        caseSessionIndex: true,
                        serviceDate: true,
                        locked: true,
                        momApproval: true,
                    },
                },
                client: {
                    select: {
                        allowSaturdayService: true,
                        allowSundayService: true,
                        allowHolidayService: true,
                    },
                },
            },
        });
        if (!loaded) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        // The client is read only for its service-day policy; keep it out of the record.
        const { client: policyClient, ...record } = loaded;
        if (
            IMMUTABLE_FINALIZATION_STATUSES.has(record.status)
            || record.status === SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED
            || record.status === SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED
        ) {
            return record;
        }

        // A stored N is kept as is: confirmed revision rows persist their
        // actual N, and a legacy row's in-period cap is applied by the
        // lifecycle ensure path when the client's period itself changes (a
        // holiday-calendar edit alone must never move N). Only a null legacy N
        // is derived from the case period. Existing zero and inconsistent
        // legacy evidence remain visible and block preview.
        // A null legacy N is derived on the CLIENT's service days: apply the
        // service-day policy of the case's own client (read with the case, in
        // this transaction) to the branch calendar.
        const required = hasAuthoritativeRevision(record) || record.requiredSessionCount !== null
            ? record.requiredSessionCount
            : legacySessionCount(
                record.startDate,
                record.endDate,
                record.requiredSessionCount,
                withClientServiceDays(
                    calendar ?? await this.holidayCalendar.forBranch(record.branchId, { fresh: true }),
                    policyClient,
                ),
            );
        const usableRequired = required ?? 0;
        const inPeriodDays = record.days.filter((day) => (
            isWithinCaregiverDateWindow(day.serviceDate, record.startDate, record.endDate)
            && (day.caseSessionIndex === null || day.caseSessionIndex <= usableRequired)
        ));
        const submitted = inPeriodDays.filter((day) => day.locked && day.momApproval === "approved").length;
        const complete = usableRequired > 0
            && inPeriodDays.length === usableRequired
            && submitted === usableRequired
            && hasCompleteHeader(record);
        const now = new Date();
        // Derive the deadline from the freshly reread end date before choosing
        // a status. A date move can leave the persisted deadline stale; using
        // that old value for the branch below would mark a future incomplete
        // case AWAITING_COMPLETION even though its new deadline has not passed.
        const effectiveFinalizationDueAt = record.endDate
            ? getServiceRecordFinalizationDueAt(record.endDate)
            : null;
        const hasActiveAssignment = record.assignments.some((assignment) =>
            assignment.schedule && !assignment.schedule.replaced && assignment.employeeId !== null);
        let status: ServiceRecordCaseStatus;

        if (!record.startDate || !record.endDate || usableRequired <= 0) {
            status = SERVICE_RECORD_CASE_STATUS.WAITING_FOR_DETAILS;
        } else if (!hasActiveAssignment) {
            status = SERVICE_RECORD_CASE_STATUS.WAITING_FOR_ASSIGNMENT;
        } else if (complete) {
            status = SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE;
        } else if (effectiveFinalizationDueAt && effectiveFinalizationDueAt <= now) {
            status = SERVICE_RECORD_CASE_STATUS.AWAITING_COMPLETION;
        } else if (isoDate(record.startDate)! > todayKst(now)) {
            status = SERVICE_RECORD_CASE_STATUS.SCHEDULED;
        } else {
            status = SERVICE_RECORD_CASE_STATUS.IN_PROGRESS;
        }

        return db.service_record_case.update({
            where: { id: record.id, branchId: record.branchId },
            data: {
                status,
                completedAt: complete ? (record.completedAt ?? now) : null,
                // Date edits can move a case's outer period without passing
                // through ensureForClient. Recompute the existing policy's
                // due instant from the freshly locked case date so a stale
                // READY/WAITING transition cannot retain the old deadline.
                finalizationDueAt: effectiveFinalizationDueAt,
                requiredSessionCount: required,
                // Caregiver content edits do not move the schedule version.
                ...(!options?.preserveVersion ? { version: { increment: 1 } } : {}),
            },
        });
    }

    async markTerminated(clientId: number, tx?: Prisma.TransactionClient, branchId?: string): Promise<void> {
        const db = tx ?? this.prisma;
        await db.service_record_case.updateMany({
            where: {
                branchId,
                clientId,
                OR: [{ babyId: null }, { baby: { is: { active: true } } }],
                status: { notIn: [...IMMUTABLE_FINALIZATION_STATUSES] },
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED,
                version: { increment: 1 },
            },
        });
    }

    private deriveBaseStatus(params: {
        startDate: Date | null;
        endDate: Date | null;
        duration: number | null;
        hasAssignment: boolean;
        terminated: boolean;
    }): ServiceRecordCaseStatus {
        if (params.terminated) return SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED;
        if (!params.startDate || !params.endDate || !params.duration || params.duration <= 0) {
            return SERVICE_RECORD_CASE_STATUS.WAITING_FOR_DETAILS;
        }
        if (!params.hasAssignment) return SERVICE_RECORD_CASE_STATUS.WAITING_FOR_ASSIGNMENT;
        return isoDate(params.startDate)! > todayKst(new Date())
            ? SERVICE_RECORD_CASE_STATUS.SCHEDULED
            : SERVICE_RECORD_CASE_STATUS.IN_PROGRESS;
    }

    private async linkLegacyDays(
        serviceRecordCaseId: string,
        schedules: Array<{
            id: number;
            startDate: Date;
            primaryEmployeeId: number;
            primaryEmployee: { name: string };
        }>,
        db: DbClient,
        branchId: string,
    ): Promise<void> {
        const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
        const scheduleIds = schedules.map((schedule) => schedule.id);
        const rows = await db.service_record_day.findMany({
            where: {
                branchId,
                scheduleId: { in: scheduleIds },
                AND: [{ OR: [{ serviceRecordCaseId }, { serviceRecordCaseId: null }] }],
                OR: [
                    { serviceRecordCaseId: null },
                    { caseSessionIndex: null },
                    { employeeId: null },
                ],
            },
            orderBy: [
                { serviceDate: "asc" },
                { scheduleId: "asc" },
                { sessionIndex: "asc" },
                { createdAt: "asc" },
            ],
        });
        if (rows.length === 0) return;

        const currentMax = await db.service_record_day.aggregate({
            where: { serviceRecordCaseId, branchId, caseSessionIndex: { not: null } },
            _max: { caseSessionIndex: true },
        });
        let nextIndex = (currentMax._max.caseSessionIndex ?? 0) + 1;
        for (const row of rows) {
            const schedule = row.scheduleId ? scheduleById.get(row.scheduleId) : undefined;
            await db.service_record_day.update({
                where: { id: row.id, branchId },
                data: {
                    serviceRecordCaseId,
                    caseSessionIndex: row.caseSessionIndex ?? nextIndex++,
                    employeeId: row.employeeId ?? schedule?.primaryEmployeeId ?? null,
                    employeeNameSnapshot: row.employeeNameSnapshot ?? schedule?.primaryEmployee.name ?? null,
                },
            });
        }
    }
}
