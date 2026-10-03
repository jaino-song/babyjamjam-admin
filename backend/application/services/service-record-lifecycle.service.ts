import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    getServiceRecordFinalizationDueAt,
    getServiceRecordTokenExpiresAt,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { UnsupportedKoreanHolidayYearError, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";

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
type ServiceRecordCaseRecord = Prisma.service_record_caseGetPayload<Prisma.service_record_caseDefaultArgs>;

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
    const frames = (new Error().stack ?? "").split("\n").slice(1)
        .map((line) => line.trim().replace(/^at (async )?/, ""))
        .filter((line) => line && !/service-record-lifecycle\.service\.(ts|js)/.test(line));
    return frames.slice(0, 3).join(" <- ") || "unknown";
}

@Injectable()
export class ServiceRecordLifecycleService {
    private readonly logger = new Logger(ServiceRecordLifecycleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    async ensureForSchedule(
        scheduleId: number,
        tx?: Prisma.TransactionClient,
    ): Promise<ServiceRecordCaseRecord | null> {
        if (!tx && typeof this.prisma.$transaction === "function") {
            // The calendar is read through the root client, so it must be read
            // before the owning transaction pins a pooled connection.
            const preRead = await this.prisma.employee_schedule.findUnique({
                where: { id: scheduleId },
                select: { clientId: true },
            });
            const calendar = preRead
                ? await this.resolveCalendarBeforeTransaction(preRead.clientId)
                : undefined;
            return this.prisma.$transaction(async (transaction) => {
                const schedule = await transaction.employee_schedule.findUnique({
                    where: { id: scheduleId },
                    select: { clientId: true },
                });
                if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                return this.ensureForClient(
                    schedule.clientId,
                    transaction,
                    schedule.clientId === preRead?.clientId ? calendar : undefined,
                );
            });
        }
        const db = tx ?? this.prisma;
        const schedule = await db.employee_schedule.findUnique({
            where: { id: scheduleId },
            select: { clientId: true },
        });
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return this.ensureForClient(schedule.clientId, tx);
    }

    /**
     * `calendar` is the branch calendar a transaction-opening caller already
     * read (fresh) before its transaction began. It is optional: without it the
     * calendar is read in here, and only when a count actually has to be
     * derived (a brand-new case, a null N, or a period that really changed).
     */
    async ensureForClient(
        clientId: number,
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<ServiceRecordCaseRecord | null> {
        // A no-transaction lifecycle call still performs a business write.
        // Put the complete read/lock/reread/upsert sequence in one owning
        // transaction so callers cannot observe a stale client or schedule
        // set and then repair it from a separate root transaction.
        if (!tx && typeof this.prisma.$transaction === "function") {
            // `holidayCalendar.forBranch` reads through the root client, so the
            // calendar is resolved before this transaction takes a pooled
            // connection; resolving it inside would hold one connection while
            // waiting for a second.
            const resolvedCalendar = calendar ?? await this.resolveCalendarBeforeTransaction(clientId);
            return this.prisma.$transaction((transaction) =>
                this.ensureForClient(clientId, transaction, resolvedCalendar));
        }
        // Captured here, before any await, while the caller's frames are still on the stack.
        const callSite = tx && !calendar ? callPath() : undefined;
        return this.ensureForClientInTransaction(clientId, tx, calendar, callSite);
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
        const existing = await this.prisma.service_record_case.findUnique({ where: { clientId } });
        if (existing && existingCaseKeepsStoredCount(existing, period)) return undefined;
        return this.holidayCalendar.forBranch(branchId, { fresh: true });
    }

    private async ensureForClientInTransaction(
        clientId: number,
        tx?: Prisma.TransactionClient,
        passedCalendar?: KrBusinessDayCalendar,
        callSite?: string,
    ): Promise<ServiceRecordCaseRecord | null> {
        const db = tx ?? this.prisma;
        let client = await db.client.findUnique({
            where: { id: clientId },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                duration: true,
                serviceStatus: true,
                employeeSchedules: {
                    include: { primaryEmployee: true },
                    orderBy: [{ startDate: "asc" }, { id: "asc" }],
                },
            },
        });
        if (!client) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const branchId = client.branchId
            ?? client.employeeSchedules.find((schedule) => schedule.branchId)?.branchId
            ?? null;
        if (!branchId || !client.startDate) return null;

        let existing = await db.service_record_case.findUnique({ where: { clientId } });

        // Lifecycle synchronization is a business write. When an owning
        // transaction is supplied, acquire the same client -> employee -> case
        // -> schedule/assignment/day order as the schedule and entry writers,
        // then reread the target set before deriving any values. This removes
        // the old post-commit root transaction race without changing lifecycle
        // status or duration semantics.
        if (
            tx
            && typeof tx.$queryRaw === "function"
        ) {
            await lockServiceRecordWriteSet(tx, {
                branchId,
                clientId,
                caseId: existing?.id,
                scheduleIds: client.employeeSchedules.map((schedule) => schedule.id),
                employeeIds: client.employeeSchedules.flatMap((schedule) => [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                ]),
            });
            const rereadClient = await db.client.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    branchId: true,
                    startDate: true,
                    endDate: true,
                    duration: true,
                    serviceStatus: true,
                    employeeSchedules: {
                        include: { primaryEmployee: true },
                        orderBy: [{ startDate: "asc" }, { id: "asc" }],
                    },
                },
            });
            if (!rereadClient) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            const rereadBranchId = rereadClient.branchId
                ?? rereadClient.employeeSchedules.find((schedule) => schedule.branchId)?.branchId
                ?? null;
            if (rereadBranchId !== branchId) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            client = rereadClient;
            existing = await db.service_record_case.findUnique({ where: { clientId } });
            if (existing && (existing.branchId !== branchId || existing.clientId !== clientId)) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
        }
        // The derived session count is persisted, so any calendar used for it
        // is read fresh (or handed in by a caller that read it before opening
        // its transaction). It is resolved lazily: a holiday-calendar edit must
        // never change a stored N on its own, so an existing case with a stored
        // N and an unchanged period needs no calendar at all.
        let calendar = passedCalendar;
        const resolveCalendar = async (): Promise<KrBusinessDayCalendar> => {
            if (!calendar) {
                if (tx) {
                    // The caller owns this transaction and did not hand a
                    // calendar in: the read below goes through the root client
                    // while the transaction holds a pooled connection. Name the
                    // call path so the caller can resolve it beforehand.
                    this.logger.warn(
                        `[CALENDAR_READ_INSIDE_TRANSACTION] clientId=${clientId} branchId=${branchId} — `
                        + "resolveCalendarBeforeTransaction() before opening the transaction and pass it "
                        + `to ensureForClient. callPath=${callSite ?? "unknown"}`,
                    );
                }
                calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
            }
            return calendar;
        };
        const finalizationDueAt = client.endDate
            ? getServiceRecordFinalizationDueAt(client.endDate)
            : null;
        const tokenExpiresAt = client.endDate
            ? getServiceRecordTokenExpiresAt(client.endDate)
            : null;
        // N is a service-record fact, separate from the nominal voucher
        // duration. A case keeps its initialized N through postponed or
        // shortened outer periods; only a brand-new case may derive N from a
        // complete supported client period. A legacy case (no revision) keeps
        // its stored N unless the client's own period moved, in which case N is
        // re-capped by the business days of the NEW period. A holiday-calendar
        // change alone never lowers (or restores) N. Legacy null/zero values
        // remain visible and are not silently backfilled.
        const sessionCount = existing
            ? existingCaseKeepsStoredCount(existing, client)
                ? existing.requiredSessionCount
                : legacySessionCount(
                    client.startDate,
                    client.endDate,
                    existing.requiredSessionCount,
                    await resolveCalendar(),
                )
            : deriveInitialSessionCount({
                startDate: client.startDate,
                endDate: client.endDate,
                calendar: await resolveCalendar(),
            });
        const immutableFinalized = Boolean(
            existing && IMMUTABLE_FINALIZATION_STATUSES.has(existing.status),
        );
        // A new client without a nominal duration may still be initialized
        // from its complete service period. Never derive a nominal duration
        // from an existing case's N.
        if (
            !existing
            && client.duration === null
            && sessionCount !== null
            && typeof db.client.updateMany === "function"
        ) {
            await db.client.updateMany({
                where: { id: clientId, branchId },
                data: { duration: sessionCount },
            });
        }
        const status = existing && IMMUTABLE_FINALIZATION_STATUSES.has(existing.status)
            ? existing.status
            : this.deriveBaseStatus({
                startDate: client.startDate,
                endDate: client.endDate,
                duration: sessionCount,
                hasAssignment: client.employeeSchedules.some((schedule) => !schedule.replaced),
                terminated: client.serviceStatus === "terminated",
            });

        const record = await db.service_record_case.upsert({
            where: { clientId, branchId },
            create: {
                branchId,
                clientId,
                status,
                startDate: client.startDate,
                endDate: client.endDate,
                requiredSessionCount: sessionCount,
                finalizationDueAt,
            },
            update: {
                branchId,
                ...(immutableFinalized
                    ? {}
                    : {
                        startDate: client.startDate,
                        endDate: client.endDate,
                        requiredSessionCount: sessionCount,
                        finalizationDueAt,
                        status,
                        version: { increment: 1 },
                    }),
            },
        });

        // Finalization claims freeze the case's source, assignments, and
        // planned vector. Lifecycle repair may still be invoked by an older
        // writer after that claim, but it must not reproject mutable client or
        // schedule fields onto the immutable case.
        if (immutableFinalized) return record;

        for (const schedule of client.employeeSchedules) {
            await db.service_record_assignment.upsert({
                where: { scheduleId: schedule.id, branchId: schedule.branchId ?? branchId },
                create: {
                    branchId: schedule.branchId ?? branchId,
                    serviceRecordCaseId: record.id,
                    scheduleId: schedule.id,
                    employeeId: schedule.primaryEmployeeId,
                    employeeNameSnapshot: schedule.primaryEmployee.name,
                    employeePhoneSnapshot: schedule.primaryEmployee.phone,
                    startDate: schedule.startDate,
                    endDate: schedule.endDate,
                },
                update: {
                    serviceRecordCaseId: record.id,
                    employeeId: schedule.primaryEmployeeId,
                    employeeNameSnapshot: schedule.primaryEmployee.name,
                    employeePhoneSnapshot: schedule.primaryEmployee.phone,
                    startDate: schedule.startDate,
                    endDate: schedule.endDate,
                },
            });
        }

        const scheduleIds = client.employeeSchedules.map((schedule) => schedule.id);
        if (scheduleIds.length > 0) {
            await Promise.all([
                db.service_record.updateMany({
                    where: { scheduleId: { in: scheduleIds }, branchId },
                    data: { serviceRecordCaseId: record.id },
                }),
                db.service_record_token.updateMany({
                    where: { scheduleId: { in: scheduleIds }, branchId },
                    data: { serviceRecordCaseId: record.id },
                }),
                db.eformsign_doc.updateMany({
                    where: {
                        branchId,
                        employeeScheduleId: { in: scheduleIds },
                        documentKind: "service_record_snapshot",
                    },
                    data: { serviceRecordCaseId: record.id },
                }),
            ]);
            await this.linkLegacyDays(record.id, client.employeeSchedules, db, branchId);
        }

        if (tokenExpiresAt) {
            // Raise expiresAt to the new grace-adjusted value, but never lower it —
            // a later-reissued token (see resolveExpiry in service-record-link.service.ts)
            // may already carry a further-out expiresAt and must not be clawed back.
            await db.service_record_token.updateMany({
                where: {
                    serviceRecordCaseId: record.id,
                    branchId,
                    active: true,
                    revokedAt: null,
                    expiresAt: { lt: tokenExpiresAt },
                },
                data: { expiresAt: tokenExpiresAt },
            });
        }

        return this.recompute(record.id, tx, calendar);
    }

    async validatePeriodChange(params: {
        clientId: number;
        startDate?: Date | null;
        endDate?: Date | null;
        duration?: number | null;
        now?: Date;
    }, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prisma;
        const record = await db.service_record_case.findUnique({
            where: { clientId: params.clientId },
            include: {
                days: { select: { serviceDate: true, locked: true } },
            },
        });
        if (!record) return;
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

        if (
            params.startDate !== undefined
            && isoDate(params.startDate) !== isoDate(record.startDate)
            && (record.days.length > 0 || (record.startDate && todayKst(now) >= isoDate(record.startDate)!))
        ) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_START_DATE_LOCKED"));
        }

        if (params.endDate === null && record.days.length > 0) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_END_DATE_REQUIRED"));
        }
        if (
            params.endDate !== undefined
            && params.endDate !== null
            && record.days.some((day) =>
                day.locked && isoDate(day.serviceDate)! > isoDate(params.endDate)!)
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
                    && currentDocument.serviceRecordCaseId !== lockedWriteSet.caseId
                )
            ) {
                return false;
            }

            if (!await this.isCurrentContractWriteTarget(tx, {
                branchId: params.branchId,
                clientId: params.clientId,
                documentId: params.documentId,
                currentDocument,
                caseId: lockedWriteSet.caseId,
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
                        (currentDocument.serviceRecordCaseId ?? null) !== null
                        && (currentDocument.serviceRecordCaseId ?? null) !== lockedWriteSet?.caseId
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
                    caseId: lockedWriteSet?.caseId ?? null,
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
            caseId: string | null;
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
        if (revisionCases.length > 1) return false;
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
                    params.caseId !== null
                    && ownerCase.id !== params.caseId
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
            && params.caseId === null;
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
                id,
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

        if (triggerRevisionId === null) {
            if (!isLegacyCaseRevisionState(lockedCase)) return false;
        } else if (
            currentRevisionId !== triggerRevisionId
            || currentUsableRevisionId !== triggerRevisionId
            || currentUsableDocumentVersion === null
            || triggerSnapshotVersion === null
            || !Number.isInteger(currentUsableDocumentVersion)
            || currentUsableDocumentVersion < 1
            || !Number.isInteger(triggerSnapshotVersion)
            || triggerSnapshotVersion < 1
            || currentUsableDocumentVersion !== triggerSnapshotVersion
        ) {
            return false;
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
            clientId: params.clientId,
            endDate: params.endDate,
        }, tx);

        // A few legacy unit-test transaction doubles
        // do not expose findUnique; those retain the historical
        // end-date-only update shape.
        let duration: number | null | undefined;
        if (typeof tx.client.findUnique === "function") {
            const currentClient = await tx.client.findUnique({
                where: { id: params.clientId },
                select: { startDate: true, duration: true },
            });
            const existingCase = typeof tx.service_record_case?.findUnique === "function"
                ? await tx.service_record_case.findUnique({
                    where: { clientId: params.clientId },
                    select: { id: true, requiredSessionCount: true },
                })
                : undefined;
            // A null client duration on a case that already has persisted
            // service-record state is legacy evidence, not permission to
            // backfill the nominal voucher from a later period edit. Keep it
            // visible for preview/repair instead of changing billing facts.
            // The no-case path retains the historical initialization needed
            // when a contract completes a client period for the first time.
            if (currentClient && currentClient.duration === null && (existingCase === null || existingCase === undefined)) {
                if (!currentClient.startDate) {
                    duration = null;
                } else {
                    const derived = deriveInitialSessionCount({
                        startDate: currentClient.startDate,
                        endDate: params.endDate,
                        calendar,
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

        await this.ensureForClient(params.clientId, tx, calendar);
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
        caseId: string | null;
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
        const existing = await tx.service_record_case.findUnique({
            where: { clientId: params.clientId },
            select: { id: true, branchId: true, clientId: true },
        });
        const caseId = existing?.branchId === params.branchId && existing.clientId === params.clientId
            ? existing.id
            : undefined;
        const result = await lockServiceRecordWriteSet(tx, {
            branchId: params.branchId,
            clientId: params.clientId,
            caseId,
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
        const rereadCase = await tx.service_record_case.findUnique({
            where: { clientId: params.clientId },
            select: { id: true, branchId: true, clientId: true },
        });
        if (
            rereadCase
            && (rereadCase.branchId !== params.branchId || rereadCase.clientId !== params.clientId)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
        }
        return {
            ...result,
            caseId: rereadCase?.id ?? null,
        };
    }

    async recompute(
        serviceRecordCaseId: string,
        tx?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
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
                        return this.recomputeInTransaction(serviceRecordCaseId, transaction, rootCalendar);
                    });
                }
                return this.recomputeInTransaction(serviceRecordCaseId, this.prisma, rootCalendar);
            }

            return this.prisma.$transaction(async (transaction) => {
                await lockServiceRecordWriteSet(transaction, {
                    branchId: discovered.branchId,
                    clientId: discoveredClientId,
                    caseId: serviceRecordCaseId,
                });
                return this.recomputeInTransaction(serviceRecordCaseId, transaction, rootCalendar);
            });
        }

        return this.recomputeInTransaction(serviceRecordCaseId, tx ?? this.prisma, calendar);
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
    ) {
        const record = await db.service_record_case.findUnique({
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
            },
        });
        if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
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
        const required = hasAuthoritativeRevision(record) || record.requiredSessionCount !== null
            ? record.requiredSessionCount
            : legacySessionCount(
                record.startDate,
                record.endDate,
                record.requiredSessionCount,
                calendar ?? await this.holidayCalendar.forBranch(record.branchId, { fresh: true }),
            );
        const usableRequired = required ?? 0;
        const inPeriodDays = record.days.filter((day) => (
            isWithinServicePeriod(day.serviceDate, record.startDate, record.endDate)
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
        const hasActiveAssignment = record.assignments.some((assignment) => assignment.schedule && !assignment.schedule.replaced);
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
                version: { increment: 1 },
            },
        });
    }

    async markTerminated(clientId: number, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prisma;
        await db.service_record_case.updateMany({
            where: { clientId, status: { notIn: [...IMMUTABLE_FINALIZATION_STATUSES] } },
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
                scheduleId: { in: scheduleIds },
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
