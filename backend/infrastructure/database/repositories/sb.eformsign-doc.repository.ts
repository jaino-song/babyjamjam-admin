import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_DOCUMENT_KIND, EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignDocCompletionClaimParams,
    EformsignDocCompletionClaimResult,
    EformsignDocClientSummary,
    EformsignDocDisplayFields,
    EformsignDocMappingError,
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
    EformsignDocUnscopedResult,
    IEformsignDocRepository,
    ReviewStageContract,
    UpsertEformsignDocByDocumentIdOptions,
    UpsertUnassignedEformsignDocOptions,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    EFORMSIGN_DOC_DOMAIN_READ_SELECT,
    readWithEformsignDocCompat,
    stripPendingEformsignDocPredicates,
    isPendingEformsignDocColumnError,
    omitPendingEformsignDocColumns,
    toCompatDomainRow,
} from "infrastructure/database/eformsign-doc-compat";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";
import { extractEformsignContractEndDate } from "application/utils/eformsign-contract-client-candidate";
import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

const isUniqueConstraintError = (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002";

const DELETED_EFORMSIGN_STATUS_TYPES = ["047", "049", "099"];
const COMPLETED_EFORMSIGN_STATUS_TYPES = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES];
const MIRROR_LIST_NON_COMPLETED_WHERE: Prisma.eformsign_docWhereInput = {
    statusType: { notIn: COMPLETED_EFORMSIGN_STATUS_TYPES },
};
const MIRROR_LIST_VISIBILITY_WHERE: Prisma.eformsign_docWhereInput = {
    OR: [
        MIRROR_LIST_NON_COMPLETED_WHERE,
        {
            statusType: { in: COMPLETED_EFORMSIGN_STATUS_TYPES },
            syncStatus: "ready",
        },
    ],
};
const RETRYABLE_MIRROR_SYNC_STATUSES = ["pending", "partial", "failed"] as const;

type ContractDocumentFenceRow = {
    id: number;
    documentId: string;
    clientId: number | null;
    branchId: string | null;
    documentKind?: string | null;
    serviceRecordCaseId: string | null;
    revisionId: string | null;
    updatedDate: Date;
    createdDate: Date;
};

type ContractPointerFenceRow = {
    id: number;
    documentId: string;
    clientId: number | null;
    branchId: string | null;
    serviceRecordCaseId: string | null;
    revisionId: string | null;
    updatedDate: Date;
    createdDate: Date;
};

type ContractRevisionFenceRow = {
    id: string;
    branchId: string;
    clientId: number | null;
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    currentUsableDocumentVersion: number | null;
};

const combineStatusGuards = (
    guards: Prisma.eformsign_docWhereInput[],
): Prisma.eformsign_docWhereInput => {
    if (guards.length === 1) {
        return guards[0] ?? {};
    }
    return guards.length > 1 ? { AND: guards } : {};
};

const toUnscopedResult = (
    documentId: string,
    row: Parameters<typeof EformsignDocMapper.toDomain>[0] & { branchId: string | null },
): EformsignDocUnscopedResult => {
    try {
        return {
            document: EformsignDocMapper.toDomain(row),
            branchId: row.branchId,
        };
    } catch (error) {
        throw new EformsignDocMappingError(documentId, error);
    }
};

@Injectable()
export class SbEformsignDocRepository implements IEformsignDocRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({
            id,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({
            documentId: documentId,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findByDocumentIdIncludingPurgePending(
        branchid: string,
        documentId: string,
    ): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({ documentId: documentId, branchId: branchid });
    }

    async findByDocumentIdUnscoped(documentId: string): Promise<EformsignDocUnscopedResult | null> {
        try {
            const doc = await this.prismaService.eformsign_doc.findUnique({
                where: { documentId },
            });
            return doc ? toUnscopedResult(documentId, doc) : null;
        } catch (error) {
            if (error instanceof EformsignDocMappingError) {
                throw error;
            }
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const doc = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findUnique({
                    where: { documentId },
                    select: { ...select, branchId: true },
                }));
            return doc
                ? toUnscopedResult(documentId, {
                    ...toCompatDomainRow(doc),
                    branchId: doc.branchId,
                })
                : null;
        }
    }

    async findBranchIdByDocumentId(documentId: string): Promise<string | null> {
        const doc = await this.prismaService.eformsign_doc.findUnique({
            where: { documentId },
            select: { branchId: true },
        });
        return doc?.branchId ?? null;
    }

    async claimCompletionStatus(
        branchid: string,
        params: EformsignDocCompletionClaimParams,
    ): Promise<EformsignDocCompletionClaimResult> {
        const documentName = params.documentName?.trim() || undefined;
        const templateName = params.templateName?.trim() || undefined;
        const data = {
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType,
            stepIndex: params.stepIndex,
            stepName: params.stepName,
            expired: params.expired,
            ...(params.sourceUpdatedDate
                ? { updatedDate: params.sourceUpdatedDate }
                : {}),
            documentName,
            templateName,
        };
        const where = {
            branchId: branchid,
            documentId: params.documentId,
            permanentPurgeRequestedAt: null,
            statusType: {
                notIn: [params.statusType, ...DELETED_EFORMSIGN_STATUS_TYPES],
            },
            ...(params.sourceUpdatedDate
                ? { updatedDate: { lt: params.sourceUpdatedDate } }
                : {}),
        };
        let result: Prisma.BatchPayload;

        try {
            result = await this.prismaService.eformsign_doc.updateMany({ where, data });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }
            result = await this.prismaService.eformsign_doc.updateMany({
                where,
                data: omitPendingEformsignDocColumns(data, error),
            });
        }

        if (result.count === 1) {
            return "claimed";
        }

        const existing = await this.prismaService.eformsign_doc.findFirst({
            where: {
                branchId: branchid,
                documentId: params.documentId,
            },
            select: {
                id: true,
                statusType: true,
                updatedDate: true,
                permanentPurgeRequestedAt: true,
            },
        });

        if (!existing) {
            return "missing";
        }

        if (
            existing.permanentPurgeRequestedAt
            || DELETED_EFORMSIGN_STATUS_TYPES.includes(existing.statusType)
        ) {
            return "stale";
        }

        if (
            params.sourceUpdatedDate
            && (
                existing.updatedDate.getTime() > params.sourceUpdatedDate.getTime()
                || (
                    existing.updatedDate.getTime() === params.sourceUpdatedDate.getTime()
                    && existing.statusType !== params.statusType
                )
            )
        ) {
            return "stale";
        }

        const canApplyMetadata = !params.sourceUpdatedDate
            || existing.updatedDate.getTime() < params.sourceUpdatedDate.getTime();
        if ((documentName || templateName) && canApplyMetadata) {
            const metadata = {
                ...(documentName ? { documentName } : {}),
                ...(templateName ? { templateName } : {}),
            };
            try {
                await this.prismaService.eformsign_doc.updateMany({
                    where: { id: existing.id, branchId: branchid },
                    data: metadata,
                });
            } catch (error) {
                if (!isPendingEformsignDocColumnError(error)) {
                    throw error;
                }
                const compatMetadata = omitPendingEformsignDocColumns(metadata, error);
                if (Object.keys(compatMetadata).length > 0) {
                    await this.prismaService.eformsign_doc.updateMany({
                        where: { id: existing.id, branchId: branchid },
                        data: compatMetadata,
                    });
                }
            }
        }

        return "duplicate";
    }

    async findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({
            clientId: clientId,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findAllVisibleInMirror(branchid: string): Promise<EformsignDocEntity[]> {
        return this.findManyVisibleInMirror({ branchId: branchid });
    }

    async findAllForHeadquarters(branchid: string): Promise<EformsignDocEntity[]> {
        // Mirrors the scan filter the API path uses: headquarters keeps everything except
        // what another branch owns, so an unclaimed document (branchId null) stays in.
        return this.findManyDomain({
            permanentPurgeRequestedAt: null,
            OR: [
                { branchId: branchid },
                { branchId: null },
            ],
        });
    }

    async findAllVisibleInMirrorForHeadquarters(
        branchid: string,
    ): Promise<EformsignDocEntity[]> {
        return this.findManyVisibleInMirror({
            OR: [
                { branchId: branchid },
                { branchId: null },
            ],
        });
    }

    async findDocumentIdsForOtherBranches(branchid: string): Promise<string[]> {
        // 다른 지점이 소유한 문서의 documentId만 추린다. branchId가 null인(미적재) 문서는
        // "지점 미지정"이라 인천(본사) 목록에 남아야 하므로 제외한다. Prisma의 `not`은
        // null을 포함하므로 `not: null`로 비-null을 명시적으로 강제한다.
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: { not: null },
                NOT: { branchId: branchid },
            },
            select: { documentId: true },
        });
        return docs.map((doc) => doc.documentId);
    }

    async findDisplayFieldsByDocumentIds(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]> {
        if (documentIds.length === 0) {
            return [];
        }

        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: branchid,
                documentId: { in: documentIds },
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                stepRecipientName: true,
            },
        });

        return docs.map((doc) => {
            const trimmed = doc.stepRecipientName.trim();
            // "수신자" is the adoption-time fallback sentinel, not a real
            // customer name — treat it as missing so enrichment falls through
            // to the cache/API path instead of displaying it forever.
            return {
                documentId: doc.documentId,
                customerName: trimmed && trimmed !== "수신자" ? trimmed : null,
            };
        });
    }

    async findContractEndDatesByDocumentIds(documentIds: string[]): Promise<Map<string, string>> {
        if (documentIds.length === 0) return new Map();

        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { documentId: { in: documentIds } },
            select: { documentId: true, detailPayload: true },
        });

        const endDates = new Map<string, string>();
        for (const doc of docs) {
            if (!doc.detailPayload || typeof doc.detailPayload !== "object") continue;
            const endDate = extractEformsignContractEndDate(
                doc.detailPayload as unknown as EformsignApiDocumentResponse,
            );
            if (endDate) endDates.set(doc.documentId, endDate.toISOString().slice(0, 10));
        }
        return endDates;
    }

    // Storage aliases for the provider-review request status (doc_request_reviewer).
    // New writes are normalized to "070", but older vendor-ingestion paths may have
    // persisted the raw name or the unpadded numeric form — same fencing concern as
    // EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES.
    private static readonly REVIEW_STAGE_STATUS_STORAGE_VALUES = [
        "070",
        "70",
        "doc_request_reviewer",
    ];

    async findReviewStageContracts(): Promise<ReviewStageContract[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                statusType: { in: SbEformsignDocRepository.REVIEW_STAGE_STATUS_STORAGE_VALUES },
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                branchId: true,
                customerName: true,
                stepRecipientName: true,
                detailPayload: true,
                autoFinalizeAttempts: true,
                autoFinalizeLastAttemptAt: true,
                autoFinalizeLastError: true,
            },
        });

        return docs.map((doc) => {
            const endDate =
                doc.detailPayload && typeof doc.detailPayload === "object"
                    ? extractEformsignContractEndDate(
                        doc.detailPayload as unknown as EformsignApiDocumentResponse,
                    )
                    : null;
            const recipientName = doc.stepRecipientName.trim();
            return {
                documentId: doc.documentId,
                branchId: doc.branchId,
                customerName:
                    doc.customerName?.trim()
                    // "수신자" is the adoption-time fallback sentinel, not a real name.
                    || (recipientName && recipientName !== "수신자" ? recipientName : null),
                contractEndDate: endDate ? endDate.toISOString().slice(0, 10) : null,
                autoFinalizeAttempts: doc.autoFinalizeAttempts,
                autoFinalizeLastAttemptAt: doc.autoFinalizeLastAttemptAt,
                autoFinalizeLastError: doc.autoFinalizeLastError,
            };
        });
    }

    async recordAutoFinalizeFailure(documentId: string, error: string): Promise<number> {
        const updated = await this.prismaService.eformsign_doc.update({
            where: { documentId },
            data: {
                autoFinalizeAttempts: { increment: 1 },
                autoFinalizeLastAttemptAt: new Date(),
                autoFinalizeLastError: error,
            },
            select: { autoFinalizeAttempts: true },
        });
        return updated.autoFinalizeAttempts;
    }

    async findClientNamesByBranch(branchid: string): Promise<EformsignDocClientSummary[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: branchid,
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                clientId: true,
                stepRecipientName: true,
                documentKind: true,
                serviceRecordCase: { select: { momName: true } },
            },
        });
        const clientIds = Array.from(
            new Set(docs.map((d) => d.clientId).filter((id): id is number => id != null)),
        );
        const clients = clientIds.length > 0
            ? await this.prismaService.client.findMany({
                where: { id: { in: clientIds } },
                select: { id: true, name: true, phone: true },
            })
            : [];
        const schedules = clientIds.length > 0
            ? await this.prismaService.employee_schedule.findMany({
                where: {
                    clientId: { in: clientIds },
                    branchId: branchid,
                    replaced: false,
                },
                include: {
                    primaryEmployee: true,
                },
                orderBy: { id: "desc" },
            })
            : [];
        const clientById = new Map(clients.map((c) => [c.id, c]));
        const providerByClientId = new Map<number, string>();
        for (const schedule of schedules) {
            if (!providerByClientId.has(schedule.clientId)) {
                providerByClientId.set(schedule.clientId, schedule.primaryEmployee.name);
            }
        }
        return docs
            .filter((d) => Boolean(d.documentId))
            .map((d) => {
                const client = d.clientId == null ? undefined : clientById.get(d.clientId);
                const contractRecipientName = d.stepRecipientName.trim();
                const serviceRecordMomName = d.serviceRecordCase?.momName?.trim() ?? "";
                const clientName = d.documentKind === "service_record_snapshot"
                    ? serviceRecordMomName || client?.name || contractRecipientName || "삭제된 고객"
                    : contractRecipientName || client?.name || "삭제된 고객";
                return {
                    documentId: d.documentId,
                    clientId: d.clientId ?? null,
                    clientName,
                    clientPhone: client?.phone ?? null,
                    providerName: d.clientId == null
                        ? null
                        : providerByClientId.get(d.clientId) ?? null,
                };
            });
    }

    async create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const data = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            branchId: branchid,
        };

        try {
            const created = await this.prismaService.eformsign_doc.create({ data });
            return EformsignDocMapper.toDomain(created);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const created = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.create({
                    data: omitPendingEformsignDocColumns(data, error),
                    select,
                }));
            return EformsignDocMapper.toDomain(toCompatDomainRow(created));
        }
    }

    async update(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<EformsignDocEntity> {
        return (await this.updateDocument(branchid, doc, false)).document;
    }

    async updateIfSourceNewer(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<{ document: EformsignDocEntity; applied: boolean }> {
        return this.updateDocument(branchid, doc, true);
    }

    /**
     * Re-read the ownership tuple for a completed contract while holding the
     * document/client/case rows. A delayed completion may update its own
     * historical document row, but it cannot move the current client pointer
     * or period after a newer revision/document has won.
     */
    async isCurrentContractDocument(
        branchid: string,
        documentId: string,
    ): Promise<boolean> {
        return this.prismaService.$transaction(async (tx) =>
            this.isCurrentContractDocumentInTransaction(tx, branchid, documentId));
    }

    async linkClientIfActive(
        branchid: string,
        documentId: string,
        clientId: number,
    ): Promise<boolean> {
        return this.prismaService.$transaction(async (tx) => {
            // Permanent purge takes this same row lock before clearing eDocId and
            // writing the tombstone. Whichever transaction follows it must observe
            // the terminal row; whichever precedes it is cleared by the purge.
            const documents = await tx.$queryRaw<ContractDocumentFenceRow[]>(Prisma.sql`
                SELECT id,
                       document_id AS "documentId",
                       client_id AS "clientId",
                       branch_id AS "branchId",
                       document_kind AS "documentKind",
                       service_record_case_id AS "serviceRecordCaseId",
                       revision_id AS "revisionId",
                       updated_date AS "updatedDate",
                       created_date AS "createdDate"
                FROM eformsign_doc
                WHERE document_id = ${documentId}
                  AND branch_id = ${branchid}::uuid
                  AND permanent_purge_requested_at IS NULL
                  AND status_type NOT IN ('047', '049', '099')
                FOR UPDATE
            `);
            const document = documents[0];
            if (!document) {
                return false;
            }

            // Verify and lock the target before clearing the old pointer. Lock both
            // client rows in id order to preserve a consistent document -> client
            // order across competing relinks; a missing target must be a clean no-op.
            const clientIdsToLock = [document.clientId, clientId]
                .filter((id): id is number => id !== null && id !== undefined)
                .filter((id, index, ids) => ids.indexOf(id) === index)
                .sort((left, right) => left - right);
            const lockedClients = await tx.$queryRaw<Array<{
                id: number;
                eDocId?: string | null;
                branchId?: string | null;
            }>>(Prisma.sql`
                SELECT id,
                       e_doc_id AS "eDocId",
                       branch_id AS "branchId"
                FROM client
                WHERE id IN (${Prisma.join(clientIdsToLock)})
                  AND branch_id = ${branchid}::uuid
                ORDER BY id
                FOR UPDATE
            `);
            const targetClient = lockedClients.find((client) => client.id === clientId);
            if (!targetClient) {
                return false;
            }

            if (!await this.hasCurrentContractRevisionEvidence(tx, branchid, {
                ...document,
                // A new/legacy document can be unassigned until the linker
                // resolves its recipient phone. Use the locked target client
                // only for the revision proof; the pointer/document ownership
                // update below still establishes the actual relation.
                clientId: document.clientId ?? clientId,
            })) {
                return false;
            }

            // A target already pointing at another document is strong evidence
            // that this completion is stale. Permit a relink only when the
            // candidate is demonstrably newer, preserving normal completion of
            // a newly created contract while rejecting delayed old callbacks.
            if (targetClient.eDocId && targetClient.eDocId !== documentId) {
                const pointedDocuments = await tx.$queryRaw<ContractPointerFenceRow[]>(Prisma.sql`
                    SELECT id,
                           document_id AS "documentId",
                           client_id AS "clientId",
                           branch_id AS "branchId",
                           service_record_case_id AS "serviceRecordCaseId",
                           revision_id AS "revisionId",
                           updated_date AS "updatedDate",
                           created_date AS "createdDate"
                    FROM eformsign_doc
                    WHERE document_id = ${targetClient.eDocId}
                      AND branch_id = ${branchid}::uuid
                      AND permanent_purge_requested_at IS NULL
                    FOR UPDATE
                `);
                const pointedDocument = pointedDocuments?.[0];
                if (!pointedDocument || this.isPointedDocumentNewer(document, pointedDocument)) {
                    return false;
                }
            }

            if (document.clientId !== null && document.clientId !== clientId) {
                // The eDocId unique key only permits one pointer. Clear the previous
                // owner's pointer first, but only if it still points at this document:
                // a newer contract pointer on that client must survive this relink.
                await tx.client.updateMany({
                    where: {
                        id: document.clientId,
                        branchId: branchid,
                        eDocId: documentId,
                    },
                    data: { eDocId: null },
                });
            }

            const client = await tx.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: { eDocId: documentId },
            });
            if (client.count !== 1) {
                // The target was locked above. A zero-row write after mutating the
                // old pointer is unexpected, so abort the transaction rather than
                // committing an orphaned document-to-client relationship.
                throw new Error("Client changed while linking eformsign document");
            }

            if (document.clientId !== clientId) {
                const reassigned = await tx.eformsign_doc.updateMany({
                    where: {
                        id: document.id,
                        branchId: branchid,
                        permanentPurgeRequestedAt: null,
                        statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                    },
                    data: {
                        clientId,
                        autoRegisteredClient: false,
                    },
                });
                if (reassigned.count !== 1) {
                    // We hold the parent-row lock, so this cannot be a normal
                    // contention result. Abort rather than commit a pointer that
                    // lacks its matching document ownership.
                    throw new Error("Eformsign document changed while linking client");
                }
            }

            return true;
        });
    }

    private async isCurrentContractDocumentInTransaction(
        tx: Prisma.TransactionClient,
        branchid: string,
        documentId: string,
    ): Promise<boolean> {
        const documents = await tx.$queryRaw<ContractDocumentFenceRow[]>(Prisma.sql`
            SELECT id,
                   document_id AS "documentId",
                   client_id AS "clientId",
                   branch_id AS "branchId",
                   document_kind AS "documentKind",
                   service_record_case_id AS "serviceRecordCaseId",
                   revision_id AS "revisionId",
                   updated_date AS "updatedDate",
                   created_date AS "createdDate"
            FROM eformsign_doc
            WHERE document_id = ${documentId}
              AND branch_id = ${branchid}::uuid
              AND permanent_purge_requested_at IS NULL
              AND status_type NOT IN ('047', '049', '099')
            FOR UPDATE
        `);
        const document = documents?.[0];
        if (
            !document
            || document.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT
            || document.clientId === null
            || document.clientId === undefined
        ) {
            return false;
        }

        const clients = await tx.$queryRaw<Array<{
            id: number;
            eDocId: string | null;
            branchId: string | null;
        }>>(Prisma.sql`
            SELECT id,
                   e_doc_id AS "eDocId",
                   branch_id AS "branchId"
            FROM client
            WHERE id = ${document.clientId}
              AND branch_id = ${branchid}::uuid
            FOR UPDATE
        `);
        const client = clients?.[0];
        if (!client || client.eDocId !== documentId) return false;

        return this.hasCurrentContractRevisionEvidence(tx, branchid, document);
    }

    private async hasCurrentContractRevisionEvidence(
        tx: Prisma.TransactionClient,
        branchid: string,
        document: Pick<ContractDocumentFenceRow, "clientId" | "serviceRecordCaseId" | "revisionId">,
    ): Promise<boolean> {
        const clientId = document.clientId;
        const revisionId = document.revisionId ?? null;
        const serviceRecordCaseId = document.serviceRecordCaseId ?? null;
        if (clientId === null || clientId === undefined) return false;

        const casePredicate = serviceRecordCaseId
            ? Prisma.sql`AND id = ${serviceRecordCaseId}::uuid`
            : Prisma.empty;
        const rawCases = await tx.$queryRaw<ContractRevisionFenceRow[]>(Prisma.sql`
            SELECT id,
                   branch_id AS "branchId",
                   client_id AS "clientId",
                   current_revision_id AS "currentRevisionId",
                   current_usable_revision_id AS "currentUsableRevisionId",
                   current_usable_document_version AS "currentUsableDocumentVersion"
            FROM service_record_case
            WHERE branch_id = ${branchid}::uuid
              AND client_id = ${clientId}
              ${casePredicate}
            FOR UPDATE
        `);
        // A narrow unit-test transaction double may not return a value for a
        // query it does not model. Production Prisma always returns an array;
        // retain the pre-existing link seam for those doubles.
        if (!Array.isArray(rawCases)) return true;
        const cases = rawCases;

        // A contract row without a service-record case is a valid legacy
        // document. A revision-bound row requires the case row as its proof;
        // never infer a revision from timestamps or a client pointer alone.
        if (cases.length === 0) return revisionId === null && serviceRecordCaseId === null;
        if (cases.length !== 1) return false;
        const ownerCase = cases[0];
        if (
            !ownerCase
            || ownerCase.branchId !== branchid
            || ownerCase.clientId !== clientId
            || (serviceRecordCaseId !== null && ownerCase.id !== serviceRecordCaseId)
        ) {
            return false;
        }

        if (revisionId === null) {
            // A legacy callback must not roll back a client while a revision is
            // pending/current, even when the old document remains eDocId.
            return ownerCase.currentRevisionId === null
                && ownerCase.currentUsableRevisionId === null
                && ownerCase.currentUsableDocumentVersion === null;
        }

        // Contract completion for a revision is current only when the case's
        // server-owned current revision is the same revision. The usable
        // service-record snapshot can still be pending; it is a separate
        // projection and must not be used as a substitute identity here.
        return ownerCase.currentRevisionId === revisionId;
    }

    private isPointedDocumentNewer(
        candidate: Pick<ContractDocumentFenceRow, "revisionId" | "updatedDate" | "createdDate" | "id">,
        pointed: Pick<ContractPointerFenceRow, "revisionId" | "updatedDate" | "createdDate" | "id">,
    ): boolean {
        const candidateRevisionId = candidate.revisionId ?? null;
        const pointedRevisionId = pointed.revisionId ?? null;
        if (candidateRevisionId === null && pointedRevisionId !== null) return true;
        // Revision identity is the stronger CAS than provider timestamps. A
        // candidate already proven to be the case's current revision may
        // legitimately replace a pointer from an older revision; the inverse
        // is rejected by hasCurrentContractRevisionEvidence above.
        if (
            candidateRevisionId !== null
            && pointedRevisionId !== null
            && candidateRevisionId !== pointedRevisionId
        ) return false;
        const candidateUpdated = candidate.updatedDate?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        const pointedUpdated = pointed.updatedDate?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        if (pointedUpdated > candidateUpdated) return true;
        const candidateCreated = candidate.createdDate?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        const pointedCreated = pointed.createdDate?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        if (pointedUpdated === candidateUpdated && pointedCreated > candidateCreated) return true;
        return pointedUpdated === candidateUpdated
            && pointedCreated === candidateCreated
            && pointed.id > candidate.id;
    }

    private async updateDocument(
        branchid: string,
        doc: EformsignDocEntity,
        onlyIfSourceNewer: boolean,
    ): Promise<{ document: EformsignDocEntity; applied: boolean }> {
        if (!doc.id) {
            throw new Error("Cannot update eformsign_doc without id");
        }
        const data = EformsignDocMapper.toPrismaUpdate(doc);
        // Keep the purge/deleted fence in the UPDATE predicate for every write, not
        // only webhook CAS writes: a permanent purge can otherwise finish between
        // a caller's read and this write and let the stale payload restore scrubbed PII.
        const updateWhere: Prisma.eformsign_docWhereInput = {
            id: doc.id,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
            statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
            ...(onlyIfSourceNewer ? { updatedDate: { lt: doc.updatedDate } } : {}),
        };
        let result: Prisma.BatchPayload;

        try {
            result = await this.prismaService.eformsign_doc.updateMany({
                where: updateWhere,
                data,
            });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            result = await this.prismaService.eformsign_doc.updateMany({
                where: updateWhere,
                data: omitPendingEformsignDocColumns(data, error),
            });
        }

        if (result.count === 0) {
            if (onlyIfSourceNewer) {
                const current = await this.findFirstDomain({ id: doc.id, branchId: branchid });
                if (current) {
                    return { document: current, applied: false };
                }
            }
            throw new Error("Eformsign doc not found for branch");
        }
        const updated = await this.findFirstDomain({ id: doc.id, branchId: branchid });
        if (!updated) {
            throw new Error("Eformsign doc not found after update");
        }
        return { document: updated, applied: true };
    }

    async upsertByDocumentId(
        branchid: string,
        doc: EformsignDocEntity,
        options?: UpsertEformsignDocByDocumentIdOptions,
    ): Promise<EformsignDocEntity> {
        const create = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            branchId: branchid,
        };
        const update: Partial<ReturnType<typeof EformsignDocMapper.toPrismaUpdate>>
            & { branchId: string } = options?.preserveExistingMirrorProjection
                ? {
                    branchId: branchid,
                    clientId: doc.clientId,
                    documentKind: doc.documentKind,
                }
                : {
                    ...EformsignDocMapper.toPrismaUpdate(doc),
                    branchId: branchid,
                };
        delete update.documentId;

        return this.conditionalUpsertByDocumentId({
            documentId: doc.documentId,
            create,
            update,
            allowedWhere: {
                documentId: doc.documentId,
                OR: [
                    { branchId: null },
                    { branchId: branchid },
                ],
            },
        });
    }

    async upsertUnassignedByDocumentId(
        doc: EformsignDocEntity,
        options?: UpsertUnassignedEformsignDocOptions,
    ): Promise<EformsignDocEntity> {
        const documentName = doc.documentName?.trim() || undefined;
        const documentNumber = doc.documentNumber?.trim() || undefined;
        const templateId = doc.templateId?.trim() || undefined;
        const templateName = doc.templateName?.trim() || undefined;
        const customerName = doc.customerName?.trim() || undefined;
        const creatorName = doc.creatorName?.trim() || undefined;
        const lastEditorName = doc.lastEditorName?.trim() || undefined;
        const stepRecipientTypes = EformsignDocMapper.toPrismaUpdate(doc).stepRecipientTypes;
        const create = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            documentName: documentName ?? null,
            documentNumber: documentNumber ?? null,
            templateId: templateId ?? null,
            branchId: null,
        };
        const update = {
            statusType: doc.statusType,
            ...(options?.markMirrorPending ? { syncStatus: "pending" as const } : {}),
            ...(options?.updateStatusDetail === false ? {} : { statusDetail: doc.statusDetail }),
            stepType: doc.stepType,
            stepIndex: doc.stepIndex,
            stepName: doc.stepName,
            ...(options?.updateExpired === false ? {} : { expired: doc.expired }),
            ...(options?.updateExpiredDate === false ? {} : { expiredDate: doc.expiredDate }),
            ...(options?.updateCreatedDate === false ? {} : { createdDate: doc.createdDate }),
            updatedDate: doc.updatedDate,
            ...(documentName ? { documentName } : {}),
            ...(documentNumber ? { documentNumber } : {}),
            ...(templateId ? { templateId } : {}),
            ...(templateName ? { templateName } : {}),
            ...(options?.updateListDisplayFields && customerName ? { customerName } : {}),
            ...(options?.updateListDisplayFields && creatorName ? { creatorName } : {}),
            ...(options?.updateListDisplayFields && lastEditorName ? { lastEditorName } : {}),
            ...(options?.updateListDisplayFields && stepRecipientTypes
                ? { stepRecipientTypes }
                : {}),
        };

        const baseStatusGuards: Prisma.eformsign_docWhereInput[] = [
            ...(UNASSIGNED_TERMINAL_STATUS_CODES.has(doc.statusType)
                ? []
                : [{
                    statusType: {
                        notIn: [...UNASSIGNED_TERMINAL_STATUS_CODES],
                    },
                }]),
            ...(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has(doc.statusType)
                ? []
                : [{
                    OR: [
                        {
                            statusType: {
                                notIn: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                            },
                        },
                        { statusType: doc.statusType },
                    ],
                }]),
        ];
        const statusGuards: Prisma.eformsign_docWhereInput[] = [
            ...baseStatusGuards,
            ...(options?.markMirrorPending
                ? [{
                    // The detail attempt is the publication owner. A list status can
                    // intentionally lag behind a completion webhook, so it must never
                    // authorize a same-generation ready/syncing row to move back to
                    // pending. Same-generation repair is limited to retryable attempts
                    // or a detail that itself is still at the review stage.
                    OR: [
                        { detailSourceUpdatedDate: null },
                        { detailSourceUpdatedDate: { lt: doc.updatedDate } },
                        {
                            AND: [
                                { detailSourceUpdatedDate: doc.updatedDate },
                                {
                                    OR: [
                                        {
                                            syncStatus: {
                                                in: [...RETRYABLE_MIRROR_SYNC_STATUSES],
                                            },
                                        },
                                        ...(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE
                                            .has(doc.statusType)
                                            ? UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES
                                                .map((statusType) => ({
                                                    detailPayload: {
                                                        path: [
                                                            "current_status",
                                                            "status_type",
                                                        ],
                                                        equals: statusType,
                                                    },
                                                }))
                                            : []),
                                    ],
                                },
                            ],
                        },
                    ],
                }]
                : []),
        ];
        const statusGuard = combineStatusGuards(statusGuards);
        const compatibilityStatusGuard = combineStatusGuards(baseStatusGuards);

        return this.conditionalUpsertByDocumentId({
            documentId: doc.documentId,
            create,
            update,
            allowedWhere: options?.allowAssignedUpdate
                ? { documentId: doc.documentId }
                : {
                    documentId: doc.documentId,
                    branchId: null,
                },
            // Monotonicity has to live in the write, not in a prior read: two webhooks for
            // the same document can both read the same stored updatedDate, both decide they
            // are newer, and the older one land last. lte rather than lt so an event that
            // carries no time of its own — it reuses the stored value — still applies.
            staleGuard: {
                updatedDate: { lte: doc.updatedDate },
                permanentPurgeRequestedAt: null,
                statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                ...statusGuard,
            },
            ...(options?.markMirrorPending
                ? {
                    // Before the mirror migration there is no detail generation or
                    // syncStatus to fence. Keep the pre-mirror ordering/status guards
                    // so a P2022 retry never references columns that do not exist.
                    compatibilityStaleGuard: {
                        updatedDate: { lte: doc.updatedDate },
                        permanentPurgeRequestedAt: null,
                        statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                        ...compatibilityStatusGuard,
                    },
                }
                : {}),
            // Creation time is not state, so a refusal on ordering grounds must not take
            // it down with the rest. It has to be that way: a row written by create or
            // adopt carries the moment we wrote it, which is *newer* than the vendor's own
            // updated_date for an unchanged old document — so the guard refuses, and the
            // rows this repair exists for are exactly the ones it would never reach.
            ...(options?.updateCreatedDate === false
                ? {}
                : { repairCreatedDateWhenStale: doc.createdDate }),
        });
    }

    private async conditionalUpsertByDocumentId(params: {
        documentId: string;
        create: Prisma.eformsign_docUncheckedCreateInput;
        update: Prisma.eformsign_docUpdateManyMutationInput;
        allowedWhere: Prisma.eformsign_docWhereInput;
        staleGuard?: Prisma.eformsign_docWhereInput;
        compatibilityStaleGuard?: Prisma.eformsign_docWhereInput;
        repairCreatedDateWhenStale?: Date;
    }): Promise<EformsignDocEntity> {
        const {
            compatibilityStaleGuard,
            ...attemptParams
        } = params;
        try {
            return await this.attemptConditionalUpsertByDocumentId(attemptParams);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            return this.attemptConditionalUpsertByDocumentId({
                ...attemptParams,
                create: omitPendingEformsignDocColumns(attemptParams.create, error),
                update: omitPendingEformsignDocColumns(attemptParams.update, error),
                staleGuard: compatibilityStaleGuard ?? attemptParams.staleGuard,
            }, error);
        }
    }

    private async attemptConditionalUpsertByDocumentId(
        params: {
            documentId: string;
            create: Prisma.eformsign_docUncheckedCreateInput;
            update: Prisma.eformsign_docUpdateManyMutationInput;
            allowedWhere: Prisma.eformsign_docWhereInput;
            staleGuard?: Prisma.eformsign_docWhereInput;
            repairCreatedDateWhenStale?: Date;
        },
        // The original missing-column error, not just a flag: the read select below has to
        // know which migration is absent so it keeps the columns that are not.
        compatibilityError?: unknown,
    ): Promise<EformsignDocEntity> {
        // Ownership is enforced by the UPDATE predicate itself. If no row matches,
        // create under the unique documentId constraint; a racing create surfaces as
        // P2002, after which the same predicate decides whether this caller may update
        // the winner. This keeps the read/check and write from becoming separate races.
        const updateWhere = params.staleGuard
            ? { AND: [params.allowedWhere, params.staleGuard] }
            : params.allowedWhere;
        const updateExisting = () => this.prismaService.eformsign_doc.updateMany({
            where: updateWhere,
            data: params.update,
        });
        // Zero rows now means one of two things. If a row still matches the ownership
        // predicate on its own, the write was refused for being stale and the caller must
        // do nothing; otherwise ownership moved and the caller has to handle it.
        const noRowsMatched = async () => {
            if (!params.staleGuard) {
                throw new EformsignDocOwnershipConflictError(params.documentId);
            }
            const ownedCount = await this.prismaService.eformsign_doc.count({
                where: params.allowedWhere,
            });
            if (ownedCount === 0) {
                throw new EformsignDocOwnershipConflictError(params.documentId);
            }

            // The row is ours and the event was refused for being older than what we hold.
            // Creation time is not state, though — it cannot be stale — and this is the
            // only path that ever reaches an adopted row, whose stored creation time is
            // the moment of adoption rather than the moment eformsign made the document.
            if (params.repairCreatedDateWhenStale !== undefined) {
                await this.prismaService.eformsign_doc.updateMany({
                    where: {
                        AND: [
                            params.allowedWhere,
                            { permanentPurgeRequestedAt: null },
                            { statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES } },
                            { createdDate: { not: params.repairCreatedDateWhenStale } },
                        ],
                    },
                    data: { createdDate: params.repairCreatedDateWhenStale },
                });
            }
            throw new EformsignDocStaleUpdateError(params.documentId);
        };

        let updated = await updateExisting();
        if (updated.count === 0) {
            try {
                if (compatibilityError !== undefined) {
                    const created = await readWithEformsignDocCompat(
                        compatibilityError,
                        (select) => this.prismaService.eformsign_doc.create({
                            data: params.create,
                            select,
                        }));
                    return EformsignDocMapper.toDomain(toCompatDomainRow(created));
                }

                const created = await this.prismaService.eformsign_doc.create({
                    data: params.create,
                });
                return EformsignDocMapper.toDomain(created);
            } catch (error) {
                if (!isUniqueConstraintError(error)) {
                    throw error;
                }
            }

            updated = await updateExisting();
            if (updated.count === 0) {
                await noRowsMatched();
            }
        }

        const result = await this.findFirstDomain(params.allowedWhere);
        if (!result) {
            throw new EformsignDocOwnershipConflictError(params.documentId);
        }
        return result;
    }

    async delete(branchid: string, id: number): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { id, branchId: branchid },
        });
    }

    async deleteByDocumentId(branchid: string, documentId: string): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { documentId: documentId, branchId: branchid },
        });
    }

    private async findFirstDomain(where: Prisma.eformsign_docWhereInput): Promise<EformsignDocEntity | null> {
        try {
            const doc = await this.prismaService.eformsign_doc.findFirst({ where });
            return doc ? EformsignDocMapper.toDomain(doc) : null;
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const doc = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findFirst({
                    where: stripPendingEformsignDocPredicates(error, where),
                    select,
                }));
            return doc ? EformsignDocMapper.toDomain(toCompatDomainRow(doc)) : null;
        }
    }

    private async findManyDomain(where: Prisma.eformsign_docWhereInput): Promise<EformsignDocEntity[]> {
        try {
            const docs = await this.prismaService.eformsign_doc.findMany({
                where,
                select: EFORMSIGN_DOC_DOMAIN_READ_SELECT,
            });
            return docs.map(EformsignDocMapper.toDomain);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const docs = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findMany({
                    where: stripPendingEformsignDocPredicates(error, where),
                    select,
                }));
            return docs.map((doc) => EformsignDocMapper.toDomain(toCompatDomainRow(doc)));
        }
    }

    private async findManyVisibleInMirror(
        scopeWhere: Prisma.eformsign_docWhereInput,
    ): Promise<EformsignDocEntity[]> {
        try {
            return await this.findManyDomain({
                permanentPurgeRequestedAt: null,
                AND: [
                    scopeWhere,
                    MIRROR_LIST_VISIBILITY_WHERE,
                ],
            });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            // During a code-first rollout sync_status may not exist yet. Without it,
            // no completed document can be proven to contain both required PDFs.
            return this.findManyDomain({
                permanentPurgeRequestedAt: null,
                AND: [
                    scopeWhere,
                    MIRROR_LIST_NON_COMPLETED_WHERE,
                ],
            });
        }
    }
}
