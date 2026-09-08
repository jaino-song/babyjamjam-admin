import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    ServiceRecordEditConflictError,
    ServiceRecordEditDraftConflictError,
    ServiceRecordEditNotFoundError,
} from "domain/errors/service-record-edit.error";
import {
    type AppendServiceRecordRevisionInput,
    type CreateServiceRecordEditDraftInput,
    type DiscardServiceRecordEditDraftInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditDraft,
    type ServiceRecordEditJsonValue,
    type ServiceRecordEditSource,
    type ServiceRecordEditSourceAssignment,
    type ServiceRecordEditSourceDay,
    type ServiceRecordRevision,
    type UpdateServiceRecordEditDraftInput,
} from "domain/repositories/service-record-edit.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type DraftRow = Prisma.service_record_edit_draftGetPayload<Record<string, never>>;
type RevisionRow = Prisma.service_record_revisionGetPayload<Record<string, never>>;
type RevisionClient = Prisma.TransactionClient;
type DraftClient = Pick<PrismaService, "service_record_edit_draft">;
type DraftLockClient = DraftClient & Pick<PrismaService, "$queryRaw">;

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === "P2002"
        : typeof error === "object"
            && error !== null
            && "code" in error
            && (error as { code?: unknown }).code === "P2002";
}

function toPrismaJson(value: ServiceRecordEditJsonValue): Prisma.InputJsonValue {
    // The editor contract stores JSON objects/arrays. The cast keeps the port
    // Prisma-free while allowing the adapter to pass its recursive value type
    // to Prisma's generated input type.
    return value as unknown as Prisma.InputJsonValue;
}

function toDomainJson(value: Prisma.JsonValue): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((item) => toDomainJson(item));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
            if (item === undefined) throw new Error("Unexpected undefined JSON value");
            return [key, toDomainJson(item)];
        }),
    );
}

function dateOnly(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

function instant(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function toDraft(row: DraftRow): ServiceRecordEditDraft {
    return {
        id: row.id,
        branchId: row.branchId,
        serviceRecordCaseId: row.serviceRecordCaseId,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        discardedByUserId: row.discardedByUserId,
        sourceCaseVersion: row.sourceCaseVersion,
        sourceFingerprint: row.sourceFingerprint,
        sourceSnapshot: row.sourceSnapshot as unknown as ServiceRecordEditJsonValue,
        changes: row.changes as unknown as ServiceRecordEditJsonValue,
        draftVersion: row.draftVersion,
        status: row.status as ServiceRecordEditDraft["status"],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        discardedAt: row.discardedAt,
    };
}

function toRevision(row: RevisionRow): ServiceRecordRevision {
    return {
        id: row.id,
        branchId: row.branchId,
        serviceRecordCaseId: row.serviceRecordCaseId,
        revisionNumber: row.revisionNumber,
        confirmedByUserId: row.confirmedByUserId,
        confirmedAt: row.confirmedAt,
        payload: row.payload as unknown as ServiceRecordEditJsonValue,
        plannedSessions: row.plannedSessions as unknown as ServiceRecordEditJsonValue,
        provenance: row.provenance as unknown as ServiceRecordEditJsonValue,
        formVersionAtConfirm: row.formVersionAtConfirm,
        snapshotReference: row.snapshotReference,
    };
}

/**
 * Prisma adapter for the editor's durable draft and revision records.
 *
 * Every lookup that can be reached with an externally supplied identifier is
 * pinned by both branch and case. A case ownership check happens before draft
 * creation and revision append, so a valid case id from another branch cannot
 * be used to probe or attach a row. Draft writes use a version predicate; the
 * database therefore accepts exactly one winner when two administrators save
 * at the same time.
 */
@Injectable()
export class ServiceRecordEditRepository implements IServiceRecordEditRepository {
    constructor(private readonly prisma: PrismaService) {}

    async createOrResumeDraft(input: CreateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        // Lock the parent case for the complete ownership-check/read/create
        // sequence. A concurrent branch reassignment therefore cannot make the
        // draft's branch snapshot disagree with the case that was checked.
        try {
            return await this.prisma.$transaction(async (tx) => {
                await this.assertCaseBelongsToBranchWithClient(tx, input.branchId, input.serviceRecordCaseId);

                const existing = await this.findActiveDraftWithClient(tx, input.branchId, input.serviceRecordCaseId);
                if (existing) return existing;

                const created = await tx.service_record_edit_draft.create({
                    data: {
                        branchId: input.branchId,
                        serviceRecordCaseId: input.serviceRecordCaseId,
                        createdByUserId: input.actorUserId,
                        updatedByUserId: input.actorUserId,
                        sourceCaseVersion: input.sourceCaseVersion,
                        sourceFingerprint: input.sourceFingerprint,
                        sourceSnapshot: toPrismaJson(input.sourceSnapshot),
                        changes: toPrismaJson(input.changes ?? {}),
                        draftVersion: 1,
                        status: "ACTIVE",
                    },
                });
                return toDraft(created);
            });
        } catch (error) {
            // A unique violation aborts the transaction, so the loser must
            // resume on the root client after rollback. (The parent-case lock
            // normally serializes this path; the index remains the final guard
            // for writers that do not use this adapter.)
            if (!isUniqueConstraintError(error)) throw error;
            const concurrent = await this.findActiveDraft(input.branchId, input.serviceRecordCaseId);
            if (!concurrent) throw error;
            return concurrent;
        }
    }

    async findActiveDraft(branchId: string, serviceRecordCaseId: string): Promise<ServiceRecordEditDraft | null> {
        return this.findActiveDraftWithClient(this.prisma, branchId, serviceRecordCaseId);
    }

    private async findActiveDraftWithClient(
        client: DraftClient,
        branchId: string,
        serviceRecordCaseId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        const row = await client.service_record_edit_draft.findFirst({
            where: {
                branchId,
                serviceRecordCaseId,
                status: "ACTIVE",
            },
            orderBy: { updatedAt: "desc" },
        });
        return row ? toDraft(row) : null;
    }

    async findDraft(
        branchId: string,
        serviceRecordCaseId: string,
        draftId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        return this.findDraftWithClient(this.prisma, branchId, serviceRecordCaseId, draftId);
    }

    private async findDraftWithClient(
        client: DraftClient,
        branchId: string,
        serviceRecordCaseId: string,
        draftId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        const row = await client.service_record_edit_draft.findFirst({
            where: {
                id: draftId,
                branchId,
                serviceRecordCaseId,
            },
        });
        return row ? toDraft(row) : null;
    }

    async findDraftById(branchId: string, draftId: string): Promise<ServiceRecordEditDraft | null> {
        const row = await this.prisma.service_record_edit_draft.findFirst({
            where: { id: draftId, branchId },
        });
        return row ? toDraft(row) : null;
    }

    async loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<ServiceRecordEditSource | null> {
        return this.prisma.$transaction(async (tx) => {
            if (target.clientId === undefined && target.caseId === undefined) return null;
            let clientId = target.clientId;
            if (clientId !== undefined) {
                const ownedClient = await tx.client.findFirst({
                    where: { id: clientId, branchId },
                    select: { id: true },
                });
                if (!ownedClient) return null;
            }

            const record = await tx.service_record_case.findFirst({
                where: {
                    branchId,
                    ...(target.caseId ? { id: target.caseId } : {}),
                    ...(clientId !== undefined ? { clientId } : {}),
                },
                select: {
                    id: true,
                    clientId: true,
                    version: true,
                    formVersion: true,
                    requiredSessionCount: true,
                    startDate: true,
                    endDate: true,
                    momName: true,
                    momBirth: true,
                    babyName: true,
                    babyBirth: true,
                    deliveryType: true,
                    babyWeight: true,
                    plannedSessions: true,
                    days: {
                        orderBy: [
                            { caseSessionIndex: "asc" },
                            { sessionIndex: "asc" },
                            { id: "asc" },
                        ],
                        select: {
                            id: true,
                            branchId: true,
                            scheduleId: true,
                            caseSessionIndex: true,
                            sessionIndex: true,
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
                            employeeId: true,
                        },
                    },
                },
            });
            if (!record || record.clientId === null) return null;
            clientId = record.clientId;

            const client = await tx.client.findFirst({
                where: { id: record.clientId, branchId },
                select: {
                    id: true,
                    branchId: true,
                    name: true,
                    duration: true,
                    startDate: true,
                    endDate: true,
                    serviceStatus: true,
                },
            });
            if (!client) return null;

            const schedules = await tx.employee_schedule.findMany({
                where: { branchId, clientId },
                orderBy: { id: "asc" },
                select: {
                    id: true,
                    branchId: true,
                    startDate: true,
                    endDate: true,
                    replaced: true,
                    terminatedAt: true,
                    primaryEmployeeId: true,
                    secondaryEmployeeId: true,
                    primaryEmployee: { select: { name: true } },
                    serviceRecordAssignment: {
                        select: {
                            id: true,
                            branchId: true,
                            serviceRecordCaseId: true,
                            scheduleId: true,
                            employeeId: true,
                            startDate: true,
                            endDate: true,
                            employeeNameSnapshot: true,
                        },
                    },
                },
            });

            const rawSessions = record.days.map((day) => ({
                id: day.id,
                branchId: day.branchId,
                sourceRowId: day.id,
                scheduleId: day.scheduleId,
                sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
                rawCaseSessionIndex: day.caseSessionIndex,
                rawSessionIndex: day.sessionIndex,
                serviceDate: dateOnly(day.serviceDate) ?? "",
                answers: toDomainJson(day.answers),
                etcService: day.etcService,
                notes: day.notes,
                paymentConfirmed: day.paymentConfirmed,
                momApproval: day.momApproval,
                clientSignature: day.clientSignature,
                clientSignedAt: instant(day.clientSignedAt),
                locked: day.locked,
                submittedAt: instant(day.submittedAt),
                employeeId: day.employeeId,
                employeeNameSnapshot: day.employeeNameSnapshot,
                formVersion: day.formVersion,
            } satisfies Omit<ServiceRecordEditSourceDay, "ambiguous">));
            const sessionIndexCounts = new Map<number, number>();
            for (const session of rawSessions) {
                sessionIndexCounts.set(session.sessionIndex, (sessionIndexCounts.get(session.sessionIndex) ?? 0) + 1);
            }
            const sessions: ServiceRecordEditSourceDay[] = rawSessions.map((session) => ({
                ...session,
                ambiguous: (sessionIndexCounts.get(session.sessionIndex) ?? 0) > 1,
            }));

            const assignments: ServiceRecordEditSourceAssignment[] = schedules.map((schedule) => ({
                id: schedule.serviceRecordAssignment?.id ?? null,
                branchId: schedule.serviceRecordAssignment?.branchId ?? schedule.branchId ?? null,
                serviceRecordCaseId: schedule.serviceRecordAssignment?.serviceRecordCaseId ?? null,
                scheduleId: schedule.id,
                employeeId: schedule.serviceRecordAssignment?.employeeId ?? schedule.primaryEmployeeId,
                startDate: dateOnly(schedule.serviceRecordAssignment?.startDate ?? schedule.startDate) ?? "",
                endDate: dateOnly(schedule.serviceRecordAssignment?.endDate ?? schedule.endDate) ?? "",
                replaced: schedule.replaced,
                employeeName: schedule.serviceRecordAssignment?.employeeNameSnapshot ?? schedule.primaryEmployee.name,
                scheduleStartDate: dateOnly(schedule.startDate) ?? "",
                scheduleEndDate: dateOnly(schedule.endDate) ?? "",
                scheduleTerminatedAt: instant(schedule.terminatedAt),
                primaryEmployeeId: schedule.primaryEmployeeId,
                secondaryEmployeeId: schedule.secondaryEmployeeId ?? null,
                primaryEmployeeName: schedule.primaryEmployee.name,
            }));

            return {
                caseId: record.id,
                caseVersion: record.version,
                formVersion: record.formVersion,
                requiredSessionCount: record.requiredSessionCount,
                startDate: dateOnly(record.startDate),
                endDate: dateOnly(record.endDate),
                header: {
                    momName: record.momName,
                    momBirth: record.momBirth,
                    babyName: record.babyName,
                    babyBirth: record.babyBirth,
                    deliveryType: record.deliveryType,
                    babyWeight: record.babyWeight,
                },
                sessions,
                assignments,
                plannedSessions: record.plannedSessions === null ? null : toDomainJson(record.plannedSessions),
                client: {
                    id: client.id,
                    branchId: client.branchId,
                    name: client.name,
                    duration: client.duration,
                    startDate: dateOnly(client.startDate),
                    endDate: dateOnly(client.endDate),
                    serviceStatus: client.serviceStatus,
                },
            };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }

    async updateDraft(input: UpdateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        // Keep the CAS write and response read in one transaction. The update
        // lock is held through the read, so a later writer cannot cause this
        // response to acknowledge another actor's changes.
        return this.prisma.$transaction(async (tx) => {
            const current = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!current) throw new ServiceRecordEditNotFoundError();
            if (current.status !== "ACTIVE") {
                throw new ServiceRecordEditDraftConflictError("The service-record draft is no longer active");
            }

            const updated = await tx.service_record_edit_draft.updateMany({
                where: {
                    id: input.draftId,
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    status: "ACTIVE",
                    draftVersion: input.expectedDraftVersion,
                },
                data: {
                    changes: toPrismaJson(input.changes),
                    draftVersion: { increment: 1 },
                    updatedByUserId: input.actorUserId,
                },
            });
            if (updated.count !== 1) {
                throw new ServiceRecordEditDraftConflictError();
            }

            const persisted = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!persisted) throw new ServiceRecordEditNotFoundError();
            return persisted;
        });
    }

    async discardDraft(input: DiscardServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        return this.prisma.$transaction(async (tx) => {
            const current = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!current) throw new ServiceRecordEditNotFoundError();
            if (current.status !== "ACTIVE") {
                throw new ServiceRecordEditDraftConflictError("The service-record draft is already closed");
            }

            const discardedAt = new Date();
            const updated = await tx.service_record_edit_draft.updateMany({
                where: {
                    id: input.draftId,
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    status: "ACTIVE",
                    draftVersion: input.expectedDraftVersion,
                },
                data: {
                    status: "DISCARDED",
                    discardedAt,
                    discardedByUserId: input.actorUserId,
                    updatedByUserId: input.actorUserId,
                    draftVersion: { increment: 1 },
                },
            });
            if (updated.count !== 1) {
                throw new ServiceRecordEditDraftConflictError();
            }

            const persisted = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!persisted) throw new ServiceRecordEditNotFoundError();
            return persisted;
        });
    }

    async appendRevision(
        input: AppendServiceRecordRevisionInput,
    ): Promise<ServiceRecordRevision> {
        return this.prisma.$transaction((tx) => this.appendRevisionWithClient(tx, input));
    }

    private async appendRevisionWithClient(
        client: RevisionClient,
        input: AppendServiceRecordRevisionInput,
    ): Promise<ServiceRecordRevision> {
        // Lock and scope the parent first. This both validates ownership and
        // serializes revision-number allocation without touching case content.
        const ownedCase = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM service_record_case
            WHERE id = ${input.serviceRecordCaseId}::uuid
              AND branch_id = ${input.branchId}::uuid
            FOR UPDATE
        `);
        if (ownedCase.length !== 1) {
            throw new ServiceRecordEditNotFoundError();
        }

        const latest = await client.service_record_revision.findFirst({
            where: {
                branchId: input.branchId,
                serviceRecordCaseId: input.serviceRecordCaseId,
            },
            orderBy: { revisionNumber: "desc" },
        });
        const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
        if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
            throw new ServiceRecordEditConflictError("Revision number must be a positive integer");
        }

        try {
            const created = await client.service_record_revision.create({
                data: {
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    revisionNumber,
                    confirmedByUserId: input.actorUserId,
                    payload: toPrismaJson(input.payload),
                    plannedSessions: toPrismaJson(input.plannedSessions),
                    provenance: toPrismaJson(input.provenance),
                    formVersionAtConfirm: input.formVersionAtConfirm,
                    snapshotReference: input.snapshotReference ?? null,
                },
            });
            return toRevision(created);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ServiceRecordEditConflictError("The revision number is already recorded");
            }
            throw error;
        }
    }

    private async assertCaseBelongsToBranchWithClient(
        client: DraftLockClient,
        branchId: string,
        serviceRecordCaseId: string,
    ): Promise<void> {
        const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM service_record_case
            WHERE id = ${serviceRecordCaseId}::uuid
              AND branch_id = ${branchId}::uuid
            FOR UPDATE
        `);
        if (rows.length !== 1) throw new ServiceRecordEditNotFoundError();
    }
}
