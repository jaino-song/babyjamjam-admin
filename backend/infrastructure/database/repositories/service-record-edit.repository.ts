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
        transaction?: unknown,
    ): Promise<ServiceRecordRevision> {
        if (transaction !== undefined) {
            return this.appendRevisionWithClient(transaction as RevisionClient, input);
        }
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
        const revisionNumber = input.revisionNumber ?? ((latest?.revisionNumber ?? 0) + 1);
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
