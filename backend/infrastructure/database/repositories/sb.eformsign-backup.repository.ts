import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES, EFORMSIGN_REVIEW_STAGE_STATUS_STORAGE_VALUES,
} from "domain/constants/eformsign-doc-status.constants";
import { BackupRunInput, IEformsignBackupRepository } from "domain/repositories/eformsign-backup.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

const backupStatuses = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES, ...EFORMSIGN_REVIEW_STAGE_STATUS_STORAGE_VALUES];
const backupDocumentSelect = {
    id: true, documentId: true, documentKind: true, documentName: true, statusType: true, detailPayload: true,
    customerName: true, createdDate: true,
    syncStatus: true, detailSourceUpdatedDate: true,
    serviceRecordCase: { select: { startDate: true } },
    employeeSchedule: { select: { startDate: true } }, client: { select: { startDate: true } },
    serviceRecordSnapshotChunk: { select: {
        serviceRecordCaseId: true, snapshotVersion: true, chunkIndex: true, chunkCount: true, firstSessionIndex: true,
    } },
    files: {
        where: { fileType: { in: ["document", "audit_trail"] } },
        select: { id: true, fileType: true, sha256: true, byteSize: true, sourceUpdatedDate: true },
    },
} satisfies Prisma.eformsign_docSelect;

@Injectable()
export class SbEformsignBackupRepository implements IEformsignBackupRepository {
    constructor(private readonly prisma: PrismaService) {}

    listDocuments(cursor: number | undefined, limit: number) {
        return runSystemScope(() => this.prisma.eformsign_doc.findMany({
            where: {
                id: { gt: cursor }, statusType: { in: backupStatuses },
                permanentPurgeRequestedAt: null,
            },
            orderBy: { id: "asc" }, take: limit,
            select: backupDocumentSelect,
        }));
    }

    listReadyEvents(since: Date, until: Date, afterId: number, limit: number) {
        return this.prisma.eformsign_webhook_event.findMany({
            where: {
                eventType: "ready_document_pdf", documentId: { not: null, notIn: [""] },
                createdAt: { gte: since, lt: until }, id: { gt: afterId },
            },
            orderBy: { id: "asc" }, take: limit,
            select: {
                id: true, documentId: true, rawStatus: true, statusType: true, sourceUpdatedDate: true, createdAt: true,
            },
        });
    }

    findReadyTarget(docId: string) {
        return runSystemScope(() => this.prisma.$transaction(async (tx) => {
            const seed = await tx.eformsign_doc.findUnique({
                where: { documentId: docId },
                select: { ...backupDocumentSelect, branchId: true, permanentPurgeRequestedAt: true },
            });
            if (!seed) return null;
            const chunk = seed.serviceRecordSnapshotChunk;
            const peers = chunk && !seed.permanentPurgeRequestedAt && backupStatuses.includes(seed.statusType)
                ? await tx.eformsign_doc.findMany({
                    where: {
                        id: { not: seed.id }, branchId: seed.branchId, permanentPurgeRequestedAt: null,
                        statusType: { in: backupStatuses },
                        serviceRecordSnapshotChunk: {
                            serviceRecordCaseId: chunk.serviceRecordCaseId, snapshotVersion: chunk.snapshotVersion,
                        },
                    },
                    orderBy: [{ serviceRecordSnapshotChunk: { firstSessionIndex: "asc" } }, { id: "asc" }],
                    take: 199, select: backupDocumentSelect,
                }) : [];
            return { seed, peers };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
    }

    findFile(fileId: string) {
        return runSystemScope(() => this.prisma.eformsign_doc_file.findUnique({
            where: { id: fileId },
            select: {
                content: true, sha256: true, sourceUpdatedDate: true,
                eformsignDoc: { select: {
                    statusType: true, permanentPurgeRequestedAt: true, syncStatus: true, detailSourceUpdatedDate: true,
                } },
            },
        }));
    }

    createRun(input: BackupRunInput) {
        return this.prisma.eformsign_backup_daily_run.create({
            data: { ...input, failures: input.failures.map(({ docId, reason }) => ({ docId, reason })) },
            select: { id: true },
        });
    }

    listRuns(limit: number) {
        return this.prisma.eformsign_backup_daily_run.findMany({
            orderBy: { startedAt: "desc" }, take: limit,
            select: {
                id: true, startedAt: true, finishedAt: true, status: true, limited: true, totalDocs: true,
                savedFiles: true, skippedFiles: true, failedFiles: true, driveStatus: true, failures: true,
            },
        });
    }
}
