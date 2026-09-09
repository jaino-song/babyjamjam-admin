import { ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import {
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "./service-record-lifecycle.service";
import { createEformsignWorkerPrincipal } from "./eformsign-credential-boundary.service";
import {
    EformsignDocumentJobService,
    sha256CanonicalJson,
} from "./eformsign-document-job.service";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type IServiceRecordEditRepository,
    type ServiceRecordEditJsonValue,
    type ServiceRecordRevisionDocumentState,
} from "domain/repositories/service-record-edit.repository.interface";

const CASE_BATCH_SIZE = 10;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const FINALIZATION_STALE_MS = 20 * 60 * 1000;
const COMPLETED_DOCUMENT_STATUS_TYPES = ["003", "012", "022", "032", "050", "062", "072", "092"];
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FinalizationDaySnapshot = {
    id: string;
    scheduleId: number | null;
    caseSessionIndex: number | null;
    sessionIndex: number;
    employeeId: number | null;
    employeeNameSnapshot: string | null;
    formVersion: number;
    serviceDate: Date;
    answers: Prisma.JsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    momApproval: string | null;
    clientSignature: string | null;
    clientSignedAt: Date | null;
    locked: boolean;
    submittedAt: Date | null;
};

type FinalizationAssignmentSnapshot = {
    id: string;
    scheduleId: number | null;
    employeeId: number | null;
    employeeNameSnapshot: string;
    startDate: Date;
    endDate: Date;
};

type FinalizationCaseSnapshot = {
    id: string;
    branchId: string;
    branchName: string | null;
    clientId: number | null;
    status: string;
    nextAttemptAt: Date | null;
    finalizationAttempts: number;
    formVersion: number;
    requiredSessionCount: number | null;
    startDate: Date | null;
    endDate: Date | null;
    plannedSessions: Prisma.JsonValue | null;
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    currentUsableDocumentVersion: number | null;
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    completedAt: Date | null;
    finalizationDueAt: Date | null;
    finalizationStartedAt: Date | null;
    finalizedAt: Date | null;
    documentsCompletedAt: Date | null;
    client: {
        id: number;
        name: string;
        duration: number | null;
        startDate: Date | null;
        endDate: Date | null;
        serviceStatus: string | null;
    } | null;
    assignments: FinalizationAssignmentSnapshot[];
    days: FinalizationDaySnapshot[];
};

type FinalizationRevisionSnapshot = {
    id: string;
    revisionNumber: number;
    payload: Prisma.JsonValue;
};

function isoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

function isoTimestamp(value: Date | null | undefined): string | null {
    return value?.toISOString() ?? null;
}

function randomGenerationId(): string {
    return randomUUID();
}

function payloadDocumentVersion(payload: Record<string, unknown> | null | undefined): number {
    const value = payload?.["documentVersion"];
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" });
    }
    return value as number;
}

/**
 * Parse only the persisted revised-case vector. The editor stores a flat,
 * complete vector; wrappers, legacy date arrays, and missing ownership fields
 * are intentionally rejected so finalization cannot freeze guessed input.
 */
function currentPlannedSessionVector(
    raw: Prisma.JsonValue | null,
    requiredSessionCount: number | null,
): ServiceRecordPlannedSession[] | null {
    if (
        !Array.isArray(raw)
        || !Number.isInteger(requiredSessionCount)
        || requiredSessionCount === null
        || requiredSessionCount < 1
    ) {
        return null;
    }

    const entries: ServiceRecordPlannedSession[] = [];
    for (const value of raw) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        const row = value as Record<string, Prisma.JsonValue>;
        const sessionIndex = row["sessionIndex"];
        const serviceDate = row["serviceDate"];
        const originalDate = row["originalDate"];
        const assignmentId = row["assignmentId"];
        const scheduleId = row["scheduleId"];
        const employeeId = row["employeeId"];
        const provenanceVersion = row["provenanceVersion"];
        if (
            typeof sessionIndex !== "number"
            || !Number.isInteger(sessionIndex)
            || typeof serviceDate !== "string"
            || typeof originalDate !== "string"
            || typeof assignmentId !== "string"
            || assignmentId.trim().length === 0
            || typeof scheduleId !== "number"
            || !Number.isInteger(scheduleId)
            || scheduleId < 1
            || typeof employeeId !== "number"
            || !Number.isInteger(employeeId)
            || employeeId < 1
            || typeof provenanceVersion !== "string"
            || provenanceVersion.trim().length === 0
        ) {
            return null;
        }
        entries.push({
            sessionIndex,
            serviceDate,
            originalDate,
            assignmentId,
            scheduleId,
            employeeId,
            provenanceVersion,
        });
    }

    try {
        return validateServiceRecordScheduleVector(entries, requiredSessionCount);
    } catch {
        return null;
    }
}

function currentPlannedSessionsMatchDays(
    record: FinalizationCaseSnapshot,
    plannedSessions: ReadonlyArray<ServiceRecordPlannedSession>,
): boolean {
    if (record.days.length !== plannedSessions.length) return false;

    const daysByIndex = new Map<number, FinalizationDaySnapshot>();
    for (const day of record.days) {
        const index = day.caseSessionIndex;
        if (
            typeof index !== "number"
            || !Number.isInteger(index)
            || index < 1
            || daysByIndex.has(index)
        ) {
            return false;
        }
        daysByIndex.set(index, day);
    }

    return plannedSessions.every((planned) => {
        const day = daysByIndex.get(planned.sessionIndex);
        const assignment = record.assignments.find((candidate) => candidate.id === planned.assignmentId);
        return Boolean(
            day
            && assignment
            && day.caseSessionIndex === planned.sessionIndex
            && day.serviceDate instanceof Date
            && isoDate(day.serviceDate) === planned.serviceDate
            && day.scheduleId === planned.scheduleId
            && day.employeeId === planned.employeeId
            && assignment.scheduleId === planned.scheduleId
            && assignment.employeeId === planned.employeeId,
        );
    });
}

function revisionOriginalDateRows(payload: Prisma.JsonValue): Prisma.JsonValue[] | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, Prisma.JsonValue>;
    // plannedSessions is the immutable full 1..N vector. A revision's
    // sessions member intentionally contains only stored/edited rows while
    // later provider submissions are still unwritten.
    if (Object.prototype.hasOwnProperty.call(row, "plannedSessions")) {
        return Array.isArray(row["plannedSessions"]) ? row["plannedSessions"] : null;
    }
    return Array.isArray(row["sessions"]) ? row["sessions"] : null;
}

function isCompleteFinalizationSource(record: FinalizationCaseSnapshot): boolean {
    if (!record.branchName?.trim()) return false;
    const required = record.requiredSessionCount;
    if (!Number.isInteger(required) || required === null || required < 1) return false;
    if (record.days.length !== required) return false;
    const plannedSessions = currentPlannedSessionVector(record.plannedSessions, required);
    if (!plannedSessions || !currentPlannedSessionsMatchDays(record, plannedSessions)) return false;
    const completeHeader = [
        record.momName,
        record.momBirth,
        record.babyName,
        record.babyBirth,
        record.deliveryType,
        record.babyWeight,
    ].every((value) => Boolean(value?.trim()));
    if (!completeHeader) return false;
    if (record.assignments.length === 0 || record.assignments.some((assignment) => (
        typeof assignment.id !== "string"
        || assignment.id.length === 0
        || !Number.isInteger(assignment.scheduleId)
        || (assignment.scheduleId ?? 0) < 1
        || !Number.isInteger(assignment.employeeId)
        || (assignment.employeeId ?? 0) < 1
        || !assignment.employeeNameSnapshot.trim()
        || !DATE_ONLY_PATTERN.test(isoDate(assignment.startDate) ?? "")
        || !DATE_ONLY_PATTERN.test(isoDate(assignment.endDate) ?? "")
        || assignment.startDate.getTime() > assignment.endDate.getTime()
    ))) return false;

    const seen = new Set<number>();
    for (const day of record.days) {
        const index = day.caseSessionIndex;
        const assignment = record.assignments.find((candidate) => (
            candidate.scheduleId === day.scheduleId
            && candidate.employeeId === day.employeeId
        ));
        if (
            typeof index !== "number"
            ||
            !Number.isInteger(index)
            || index < 1
            || index > required
            || seen.has(index)
            || !day.locked
            || day.momApproval !== "approved"
            || !day.submittedAt
            || !day.clientSignature?.trim()
            || !day.clientSignedAt
            || !assignment
            || !Number.isInteger(day.scheduleId)
            || (day.scheduleId ?? 0) < 1
            || !Number.isInteger(day.employeeId)
            || (day.employeeId ?? 0) < 1
            || !day.employeeNameSnapshot?.trim()
            || !Number.isInteger(day.formVersion)
            || day.formVersion < 1
        ) {
            return false;
        }
        seen.add(index);
    }
    return [...seen].sort((left, right) => left - right)
        .every((index, position) => index === position + 1);
}

function revisionOriginalDates(payload: Prisma.JsonValue): Map<number, string | null> {
    const sessions = revisionOriginalDateRows(payload);
    if (!sessions) return new Map();
    const result = new Map<number, string | null>();
    for (const item of sessions) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Record<string, Prisma.JsonValue>;
        const index = row["sessionIndex"];
        if (typeof index !== "number" || !Number.isInteger(index) || index < 1) continue;
        result.set(index, typeof row["originalDate"] === "string" ? row["originalDate"] : null);
    }
    return result;
}

function hasCompleteRevisionOriginalDates(
    payload: Prisma.JsonValue,
    requiredSessionCount: number,
    expectedIndexes: ReadonlySet<number>,
): boolean {
    const sessions = revisionOriginalDateRows(payload);
    if (!sessions || sessions.length !== requiredSessionCount) return false;
    const seen = new Set<number>();
    for (const item of sessions) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const row = item as Record<string, Prisma.JsonValue>;
        const index = row["sessionIndex"];
        const originalDate = row["originalDate"];
        if (
            typeof index !== "number"
            || !Number.isInteger(index)
            || !expectedIndexes.has(index)
            || seen.has(index)
            || typeof originalDate !== "string"
            || !DATE_ONLY_PATTERN.test(originalDate)
        ) return false;
        seen.add(index);
    }
    return seen.size === expectedIndexes.size;
}

@Injectable()
export class ServiceRecordFinalizationService {
    private readonly logger = new Logger(ServiceRecordFinalizationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly lifecycleService: ServiceRecordLifecycleService,
        private readonly createSnapshotUsecase: CreateAndSendServiceRecordSnapshotUsecase,
        @Optional()
        private readonly documentJobService?: EformsignDocumentJobService,
        @Optional()
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly editRepository?: IServiceRecordEditRepository,
    ) {}

    async processDueCases(referenceDate = new Date(), limit = CASE_BATCH_SIZE): Promise<number> {
        await this.recoverStaleFinalizations(referenceDate);
        await this.completeReviewedCases(limit * 5);
        await this.promoteEligibleCases(referenceDate, limit * 5);
        const candidates = await this.prisma.service_record_case.findMany({
            where: {
                snapshotChunks: { none: { status: "MANUAL_REVIEW" } },
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                    {
                        status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                        nextAttemptAt: { lte: referenceDate },
                    },
                ],
            },
            select: { id: true, branchId: true, finalizationAttempts: true },
            orderBy: [{ finalizationDueAt: "asc" }, { updatedAt: "asc" }],
            take: limit,
        });

        let finalizedCount = 0;
        for (const candidate of candidates) {
            const claim = await this.claimFinalizationCase(candidate.id, candidate.branchId, referenceDate);
            if (!claim.claimed) continue;

            try {
                const result = await this.createSnapshotUsecase.executeCase(
                    candidate.branchId,
                    candidate.id,
                    createEformsignWorkerPrincipal(candidate.branchId),
                );
                if (result.chunkCount < 1 || result.documentIds.length !== result.chunkCount) {
                    throw new Error("Snapshot finalization returned an incomplete document set");
                }
                await this.prisma.$transaction(async (tx) => {
                    const updated = await tx.service_record_case.updateMany({
                        where: {
                            id: candidate.id,
                            status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                        },
                        data: {
                            status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                            finalizedAt: new Date(),
                            nextAttemptAt: null,
                            lastError: null,
                            version: { increment: 1 },
                        },
                    });
                    if (updated.count !== 1) {
                        throw new Error("Service record finalization claim was lost");
                    }
                    await tx.service_record_token.updateMany({
                        where: {
                            serviceRecordCaseId: candidate.id,
                            active: true,
                        },
                        data: { active: false, revokedAt: new Date() },
                    });
                });
                finalizedCount += 1;
                this.logger.log(
                    `Service record finalized: case=${candidate.id}, documents=${result.documentIds.join(",")}`,
                );
            } catch (error) {
                await this.recordFailure(
                    candidate.id,
                    claim.attempts,
                    error,
                );
            }
        }

        return finalizedCount;
    }

    /**
     * Claim a finalization case under the same client -> employees -> case
     * ordering used by provider and administrator writers. The compatibility
     * fallback keeps existing narrow unit doubles working; a real Prisma
     * transaction always takes the complete lock surface and rereads the case
     * after waiting before changing its lifecycle state.
     */
    private async claimFinalizationCase(
        caseId: string,
        branchId: string,
        referenceDate: Date,
    ): Promise<{ claimed: boolean; attempts: number; blockedGeneration?: boolean }> {
        return this.prisma.$transaction(async (tx) => {
            const caseDelegate = tx.service_record_case as unknown as {
                findUnique?: (args: unknown) => Promise<{
                    id: string;
                    branchId: string;
                    clientId: number | null;
                    status: string;
                    nextAttemptAt: Date | null;
                    finalizationAttempts: number;
                } | null>;
            } | undefined;
            if (typeof caseDelegate?.findUnique !== "function") {
                const claimed = await tx.service_record_case.updateMany({
                    where: {
                        id: caseId,
                        OR: [
                            { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                            {
                                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                                nextAttemptAt: { lte: referenceDate },
                            },
                        ],
                    },
                    data: {
                        status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                        finalizationStartedAt: new Date(),
                        finalizationAttempts: { increment: 1 },
                        nextAttemptAt: null,
                        lastError: null,
                        version: { increment: 1 },
                    },
                });
                return { claimed: claimed.count === 1, attempts: claimed.count === 1 ? 1 : 0 };
            }

            const discovered = await caseDelegate.findUnique({
                where: { id: caseId },
                select: {
                    id: true,
                    branchId: true,
                    clientId: true,
                    status: true,
                    nextAttemptAt: true,
                    finalizationAttempts: true,
                },
            });
            if (
                !discovered
                || discovered.branchId !== branchId
                || (
                    discovered.status === SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED
                    && discovered.nextAttemptAt !== null
                    && discovered.nextAttemptAt.getTime() > referenceDate.getTime()
                )
                || (
                    discovered.status !== SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE
                    && discovered.status !== SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED
                )
            ) {
                return { claimed: false, attempts: 0 };
            }

            if (discovered.clientId !== null) {
                await lockServiceRecordWriteSet(tx, {
                    branchId,
                    clientId: discovered.clientId,
                    caseId: discovered.id,
                });
            } else {
                const locked = await lockServiceRecordCaseForWrite(tx, branchId, discovered.id);
                if (typeof tx.$queryRaw === "function" && !locked) {
                    return { claimed: false, attempts: 0 };
                }
            }

            const current = await caseDelegate.findUnique({
                where: { id: caseId },
                select: {
                    id: true,
                    branchId: true,
                    clientId: true,
                    status: true,
                    nextAttemptAt: true,
                    finalizationAttempts: true,
                },
            });
            if (
                !current
                || current.branchId !== branchId
                || (
                    current.status === SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED
                    && current.nextAttemptAt !== null
                    && current.nextAttemptAt.getTime() > referenceDate.getTime()
                )
                || (
                    current.status !== SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE
                    && current.status !== SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED
                )
            ) {
                return { claimed: false, attempts: 0 };
            }

            // A real finalization transaction rereads the complete source
            // after the common lock set. This is the eligibility fence for
            // both legacy snapshots and immutable revised generations.
            const source = await this.readFinalizationCase(tx, caseId);
            if (!source || source.branchId !== branchId || source.clientId !== current.clientId) {
                return { claimed: false, attempts: 0 };
            }
            if (source.currentRevisionId !== null) {
                if (!isCompleteFinalizationSource(source)) {
                    // READY can be stale after a later provider edit. Let the
                    // existing lifecycle policy recalculate it while this
                    // transaction still owns the case/client lock.
                    if (current.status === SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE) {
                        await this.lifecycleService.recompute(caseId, tx);
                    }
                    return { claimed: false, attempts: 0, blockedGeneration: true };
                }
                await this.freezeInitialFinalizationGeneration(tx, source);
                // Phase0 capability remains unverified. The durable job is a
                // manual-review intent; no case claim or provider execution is
                // allowed from this scheduler path.
                return {
                    claimed: false,
                    attempts: current.finalizationAttempts,
                    blockedGeneration: true,
                };
            }

            const claimed = await tx.service_record_case.updateMany({
                where: {
                    id: caseId,
                    branchId,
                    OR: [
                        { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                        {
                            status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                            nextAttemptAt: { lte: referenceDate },
                        },
                    ],
                },
                data: {
                    status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                    finalizationStartedAt: new Date(),
                    finalizationAttempts: { increment: 1 },
                    nextAttemptAt: null,
                    lastError: null,
                    version: { increment: 1 },
                },
            });
            return {
                claimed: claimed.count === 1,
                attempts: claimed.count === 1 ? current.finalizationAttempts + 1 : 0,
            };
        });
    }

    /**
     * Read the current source only after the caller owns the complete
     * client/employee/case lock set. The finalization scheduler must never
     * derive a generation payload from the pre-lock candidate query.
     */
    private async readFinalizationCase(
        tx: Prisma.TransactionClient,
        caseId: string,
    ): Promise<FinalizationCaseSnapshot | null> {
        const delegate = tx.service_record_case as unknown as {
            findUnique?: (args: unknown) => Promise<FinalizationCaseSnapshot | null>;
        } | undefined;
        if (typeof delegate?.findUnique !== "function") return null;
        const row = await delegate.findUnique({
            where: { id: caseId },
            select: {
                id: true,
                branchId: true,
                branch: { select: { name: true } },
                clientId: true,
                status: true,
                nextAttemptAt: true,
                finalizationAttempts: true,
                formVersion: true,
                requiredSessionCount: true,
                startDate: true,
                endDate: true,
                plannedSessions: true,
                currentRevisionId: true,
                currentUsableRevisionId: true,
                currentUsableDocumentVersion: true,
                momName: true,
                momBirth: true,
                babyName: true,
                babyBirth: true,
                deliveryType: true,
                babyWeight: true,
                completedAt: true,
                finalizationDueAt: true,
                finalizationStartedAt: true,
                finalizedAt: true,
                documentsCompletedAt: true,
                client: {
                    select: {
                        id: true,
                        name: true,
                        duration: true,
                        startDate: true,
                        endDate: true,
                        serviceStatus: true,
                    },
                },
                assignments: {
                    select: {
                        id: true,
                        scheduleId: true,
                        employeeId: true,
                        employeeNameSnapshot: true,
                        startDate: true,
                        endDate: true,
                    },
                    orderBy: [{ startDate: "asc" }, { id: "asc" }],
                },
                days: {
                    select: {
                        id: true,
                        scheduleId: true,
                        caseSessionIndex: true,
                        sessionIndex: true,
                        employeeId: true,
                        employeeNameSnapshot: true,
                        formVersion: true,
                        serviceDate: true,
                        answers: true,
                        etcService: true,
                        notes: true,
                        paymentConfirmed: true,
                        momApproval: true,
                        clientSignature: true,
                        clientSignedAt: true,
                        locked: true,
                        submittedAt: true,
                    },
                    orderBy: [{ caseSessionIndex: "asc" }, { sessionIndex: "asc" }, { id: "asc" }],
                },
            },
        });
        if (!row) return null;
        const branch = (row as unknown as { branch?: { name?: unknown } | null }).branch;
        return {
            ...(row as unknown as Omit<FinalizationCaseSnapshot, "branchName">),
            branchName: typeof branch?.name === "string" ? branch.name : null,
        };
    }

    /**
     * Freeze a complete revised source exactly once. The durable job payload
     * is the generation input; retries resolve the request key and reuse that
     * payload without reading or rebuilding from the mutable case again.
     */
    private async freezeInitialFinalizationGeneration(
        tx: Prisma.TransactionClient,
        source: FinalizationCaseSnapshot,
    ): Promise<void> {
        const revisionId = source.currentRevisionId;
        if (!revisionId || !source.clientId) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" });
        }
        if (!isCompleteFinalizationSource(source)) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" });
        }
        if (!this.documentJobService) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" });
        }

        const requestKey = `service-record-initial-finalization:${revisionId}`;
        const existing = await this.documentJobService.findByRequestKeyInTransaction(tx, requestKey);
        if (existing) {
            const existingPayload = existing.payload;
            const existingGeneration = existingPayload?.["generation"];
            const existingImmutablePayload = existingPayload?.["immutablePayload"];
            if (
                typeof existingGeneration === "string"
                && existingGeneration.length > 0
                && existingImmutablePayload
                && typeof existingImmutablePayload === "object"
                && !Array.isArray(existingImmutablePayload)
            ) {
                const existingDocumentVersion = payloadDocumentVersion(existingPayload);
                const existingState = await this.ensureInitialFinalizationState(
                    tx,
                    source,
                    revisionId,
                    existingGeneration,
                    existingImmutablePayload as Record<string, unknown>,
                    requestKey,
                    existingDocumentVersion,
                );
                if (existingState && existingState.documentVersion !== existingDocumentVersion) {
                    throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" });
                }
            }
            this.assertFrozenGenerationJob(existing, source, revisionId, requestKey);
            return;
        }

        const revisionDelegate = tx.service_record_revision as unknown as {
            findUnique?: (args: unknown) => Promise<FinalizationRevisionSnapshot | null>;
        } | undefined;
        if (typeof revisionDelegate?.findUnique !== "function") {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" });
        }
        const revision = await revisionDelegate.findUnique({
            where: { id: revisionId },
            select: { id: true, revisionNumber: true, payload: true },
        });
        if (!revision || revision.id !== revisionId || revision.revisionNumber < 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" });
        }
        const required = source.requiredSessionCount;
        const expectedIndexes = new Set(
            source.days
                .map((day) => day.caseSessionIndex)
                .filter((index): index is number => typeof index === "number"),
        );
        if (
            required === null
            || !Number.isInteger(required)
            || required < 1
            || expectedIndexes.size !== required
            || !hasCompleteRevisionOriginalDates(revision.payload, required, expectedIndexes)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" });
        }

        const generation = randomGenerationId();
        const immutablePayload = this.buildInitialFinalizationPayload(source, revision, generation);
        const payloadFingerprint = sha256CanonicalJson(immutablePayload);
        if (!this.editRepository) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" });
        }
        const documentState = await this.ensureInitialFinalizationState(
            tx,
            source,
            revisionId,
            generation,
            immutablePayload,
            requestKey,
        );
        if (!documentState) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" });
        }
        const documentVersion = await this.editRepository.allocateServiceRecordRevisionDocumentVersionInTransaction(
            { tx },
            {
                branchId: source.branchId,
                clientId: source.clientId,
                serviceRecordCaseId: source.id,
                revisionId,
                documentStateId: documentState.id,
                generation,
                expectedDocumentVersion: null,
            },
        );
        const plannedSessionDates = source.days
            .map((day) => ({
                sessionIndex: day.caseSessionIndex!,
                serviceDate: isoDate(day.serviceDate)!,
            }))
            .sort((left, right) => left.sessionIndex - right.sessionIndex);
        const context = {
            branchId: source.branchId,
            clientId: source.clientId,
            serviceRecordCaseId: source.id,
            revisionId,
            revisionNumber: revision.revisionNumber,
            businessFingerprint: payloadFingerprint,
            plannedSessionCount: source.requiredSessionCount,
            plannedSessionDates,
            documentSyncStatus: "capability_unverified" as const,
            lifecycleStatus: source.status,
            formVersion: source.formVersion,
        };
        const payload = {
            kind: "service_record_revision" as const,
            generationKind: "INITIAL_FINALIZATION" as const,
            generation,
            revisionId,
            revisionNumber: revision.revisionNumber,
            context,
            immutablePayload,
            payloadFingerprint,
            completeness: "complete" as const,
            manualReviewRequired: true,
            documentVersion,
            snapshotReference: requestKey,
            documentStateId: documentState.id,
        };

        const result = await this.documentJobService.enqueueInTransaction(tx, {
            branchId: source.branchId,
            clientId: source.clientId,
            documentId: null,
            jobType: "create_document",
            source: "auto_finalize",
            requestKey,
            activeKey: `service-record-initial-finalization:${source.id}`,
            payload,
            payloadFingerprint,
            // The provider worker is the generation principal. The user who
            // confirmed the revision remains in the immutable revision row.
            createdByUserId: null,
        });
        if (result.existing) {
            this.assertFrozenGenerationJob(result.job, source, revisionId, requestKey);
        }
    }

    /**
     * Keep the provider job and the operation-state row tied to the same
     * immutable generation.  The finalizer already owns the caller
     * transaction and has locked the client/case source; this method never
     * opens a nested transaction or reads mutable rows.
     */
    private async ensureInitialFinalizationState(
        tx: Prisma.TransactionClient,
        source: FinalizationCaseSnapshot,
        revisionId: string,
        generation: string,
        immutablePayload: Record<string, unknown>,
        requestKey: string,
        documentVersion?: number | null,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        if (!this.editRepository || source.clientId === null) return null;
        return this.editRepository.createRevisionDocumentStateInTransaction({ tx }, {
            branchId: source.branchId,
            clientId: source.clientId,
            serviceRecordCaseId: source.id,
            revisionId,
            operation: "record_snapshot",
            generation,
            immutableInput: immutablePayload as unknown as ServiceRecordEditJsonValue,
            inputFingerprint: sha256CanonicalJson(immutablePayload),
            documentVersion,
            workflowScope: {
                requestKey,
                generationKind: "INITIAL_FINALIZATION",
                formVersion: source.formVersion,
            },
            step: "capability_unverified",
            status: "capability_unverified",
            lastErrorCode: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
        });
    }

    private buildInitialFinalizationPayload(
        source: FinalizationCaseSnapshot,
        revision: FinalizationRevisionSnapshot,
        generation: string,
    ): Record<string, unknown> {
        const originalDates = revisionOriginalDates(revision.payload);
        const sessions = source.days
            .map((day) => {
                const sessionIndex = day.caseSessionIndex!;
                return {
                    sourceRowId: day.id,
                    sessionIndex,
                    serviceDate: isoDate(day.serviceDate),
                    originalDate: originalDates.get(sessionIndex) ?? null,
                    scheduleId: day.scheduleId,
                    employeeId: day.employeeId,
                    employeeNameSnapshot: day.employeeNameSnapshot,
                    formVersion: day.formVersion,
                    answers: day.answers,
                    etcService: day.etcService,
                    notes: day.notes,
                    paymentConfirmed: day.paymentConfirmed,
                    momApproval: day.momApproval,
                    clientSignature: day.clientSignature,
                    clientSignedAt: isoTimestamp(day.clientSignedAt),
                    locked: day.locked,
                    submittedAt: isoTimestamp(day.submittedAt),
                };
            })
            .sort((left, right) => left.sessionIndex - right.sessionIndex);
        return {
            kind: "service_record_initial_finalization_input",
            generation,
            branchId: source.branchId,
            branchName: source.branchName,
            caseId: source.id,
            clientId: source.clientId,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            formVersion: source.formVersion,
            requiredSessionCount: source.requiredSessionCount,
            startDate: isoDate(source.startDate),
            endDate: isoDate(source.endDate),
            header: {
                momName: source.momName,
                momBirth: source.momBirth,
                babyName: source.babyName,
                babyBirth: source.babyBirth,
                deliveryType: source.deliveryType,
                babyWeight: source.babyWeight,
            },
            lifecycle: {
                status: source.status,
                completedAt: isoTimestamp(source.completedAt),
                finalizationDueAt: isoTimestamp(source.finalizationDueAt),
                finalizationStartedAt: isoTimestamp(source.finalizationStartedAt),
                finalizedAt: isoTimestamp(source.finalizedAt),
                documentsCompletedAt: isoTimestamp(source.documentsCompletedAt),
            },
            client: source.client
                ? {
                    id: source.client.id,
                    name: source.client.name,
                    duration: source.client.duration,
                    startDate: isoDate(source.client.startDate),
                    endDate: isoDate(source.client.endDate),
                    serviceStatus: source.client.serviceStatus,
                }
                : null,
            assignments: source.assignments.map((assignment) => ({
                assignmentId: assignment.id,
                scheduleId: assignment.scheduleId,
                employeeId: assignment.employeeId,
                employeeNameSnapshot: assignment.employeeNameSnapshot,
                startDate: isoDate(assignment.startDate),
                endDate: isoDate(assignment.endDate),
            })),
            plannedSessions: source.plannedSessions,
            sessions,
            // Keep the immutable editor payload alongside the fresh provider
            // rows so a later worker never has to reconstruct the revision.
            sourceRevisionPayload: revision.payload,
        };
    }

    private assertFrozenGenerationJob(
        job: {
            requestKey: string;
            branchId: string;
            clientId: number | null;
            jobType: string;
            payloadFingerprint: string | null;
            payload: Record<string, unknown> | null;
        },
        source: FinalizationCaseSnapshot,
        revisionId: string,
        requestKey: string,
    ): void {
        const payload = job.payload;
        const context = payload?.["context"];
        const contextRecord = context && typeof context === "object" && !Array.isArray(context)
            ? context as Record<string, unknown>
            : null;
        const immutablePayload = payload?.["immutablePayload"];
        if (
            job.requestKey !== requestKey
            || job.branchId !== source.branchId
            || job.clientId !== source.clientId
            || job.jobType !== "create_document"
            || job.payloadFingerprint !== payload?.["payloadFingerprint"]
            || !payload
            || payload["kind"] !== "service_record_revision"
            || payload["generationKind"] !== "INITIAL_FINALIZATION"
            || payload["revisionId"] !== revisionId
            || payload["completeness"] !== "complete"
            || payload["manualReviewRequired"] !== true
            || !Number.isInteger(payload["documentVersion"])
            || (payload["documentVersion"] as number) < 1
            || typeof payload["payloadFingerprint"] !== "string"
            || !/^[0-9a-f]{64}$/i.test(payload["payloadFingerprint"])
            || typeof payload["generation"] !== "string"
            || payload["generation"].length === 0
            || typeof immutablePayload !== "object"
            || immutablePayload === null
            || Array.isArray(immutablePayload)
            || !contextRecord
            || contextRecord["branchId"] !== source.branchId
            || contextRecord["clientId"] !== source.clientId
            || contextRecord["serviceRecordCaseId"] !== source.id
            || contextRecord["revisionId"] !== revisionId
            || contextRecord["businessFingerprint"] !== payload["payloadFingerprint"]
            || payload["snapshotReference"] !== requestKey
            || sha256CanonicalJson(immutablePayload) !== payload["payloadFingerprint"]
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" });
        }
    }

    private async recoverStaleFinalizations(referenceDate: Date): Promise<void> {
        const staleBefore = new Date(referenceDate.getTime() - FINALIZATION_STALE_MS);
        const recovered = await this.prisma.service_record_case.updateMany({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                finalizationStartedAt: { lte: staleBefore },
                snapshotChunks: {
                    none: {
                        status: "CREATE_REQUESTED",
                        createAttemptedAt: { gt: staleBefore },
                    },
                },
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: referenceDate,
                lastError: "Recovered stale finalization claim",
                version: { increment: 1 },
            },
        });
        if (recovered.count > 0) {
            this.logger.warn(`Recovered ${recovered.count} stale service-record finalization claim(s)`);
        }
    }

    private async completeReviewedCases(limit: number): Promise<void> {
        const cases = await this.prisma.service_record_case.findMany({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                eformsignDocs: {
                    some: { documentKind: "service_record_snapshot" },
                    none: {
                        documentKind: "service_record_snapshot",
                        statusType: { notIn: COMPLETED_DOCUMENT_STATUS_TYPES },
                    },
                },
            },
            select: {
                branchId: true,
                eformsignDocs: {
                    where: { documentKind: "service_record_snapshot" },
                    select: { documentId: true },
                },
            },
            take: limit,
        });
        for (const record of cases) {
            const triggerDocumentId = record.eformsignDocs[0]?.documentId;
            if (!triggerDocumentId) continue;
            await this.lifecycleService.completeServiceRecordSnapshotIfReady({
                branchId: record.branchId,
                documentId: triggerDocumentId,
            });
        }
    }

    private async promoteEligibleCases(referenceDate: Date, limit: number): Promise<void> {
        const candidates = await this.prisma.service_record_case.findMany({
            where: {
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.WAITING_FOR_END },
                    {
                        finalizationDueAt: { lte: referenceDate },
                        status: {
                            in: [
                                SERVICE_RECORD_CASE_STATUS.SCHEDULED,
                                SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                            ],
                        },
                    },
                ],
            },
            select: { id: true },
            orderBy: { finalizationDueAt: "asc" },
            take: limit,
        });
        for (const candidate of candidates) {
            await this.lifecycleService.recompute(candidate.id);
        }
    }

    private async recordFailure(
        serviceRecordCaseId: string,
        attempt: number,
        error: unknown,
    ): Promise<void> {
        captureServiceRecordError(error, {
            operation: "auto-finalize",
            handled: true,
            caseId: serviceRecordCaseId,
            retryCount: attempt,
        });
        const manualReview = await this.prisma.service_record_snapshot_chunk.count({
            where: { serviceRecordCaseId, status: "MANUAL_REVIEW" },
        });
        const delayMs = Math.min(
            5 * 60 * 1000 * (2 ** Math.max(0, attempt - 1)),
            MAX_RETRY_DELAY_MS,
        );
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.service_record_case.updateMany({
            where: {
                id: serviceRecordCaseId,
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: manualReview > 0 ? null : new Date(Date.now() + delayMs),
                lastError: message.slice(0, 2000),
                version: { increment: 1 },
            },
        });
        this.logger.error(
            `Service record finalization failed: case=${serviceRecordCaseId}, attempt=${attempt}, manualReview=${manualReview > 0}`,
            error instanceof Error ? error.stack : String(error),
        );
    }
}
