import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { extractEformsignContractStartDate } from "application/utils/eformsign-contract-client-candidate";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES, EFORMSIGN_REVIEW_STAGE_STATUS_STORAGE_VALUES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    BackupDocumentRow, BackupFailure, BackupRunInput, EFORMSIGN_BACKUP_REPOSITORY, IEformsignBackupRepository,
} from "domain/repositories/eformsign-backup.repository.interface";

type BackupDocumentKind = "contract" | "service_record" | "other";

const CONTRACT_NAME_PREFIX = "산모신생아건강관리서비스";
const SERVICE_RECORD_NAME_PREFIX = "서비스 제공기록지";

function backupDocumentKind(row: BackupDocumentRow): BackupDocumentKind {
    if (row.documentKind === "service_record_snapshot") return "service_record";
    if (row.documentKind === "contract") return "contract";
    if (row.documentKind !== null) return "other";
    if (row.documentName?.startsWith(CONTRACT_NAME_PREFIX)) return "contract";
    if (row.documentName?.startsWith(SERVICE_RECORD_NAME_PREFIX)) return "service_record";
    return "other";
}

const isCompletedStatus = (statusType: string) => EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES.includes(statusType);
const isReviewStageStatus = (statusType: string) => EFORMSIGN_REVIEW_STAGE_STATUS_STORAGE_VALUES.includes(statusType);
// Completed documents are backed up once fully synced; review-stage ones from the first (partial) sync on.
const isBackupReadySync = (statusType: string, syncStatus: string) =>
    syncStatus === "ready" ? isCompletedStatus(statusType) || isReviewStageStatus(statusType)
        : syncStatus === "partial" && isReviewStageStatus(statusType);

function payloadStartDate(detailPayload: unknown): Date | null {
    if (typeof detailPayload !== "object" || detailPayload === null || Array.isArray(detailPayload)) return null;
    return extractEformsignContractStartDate(detailPayload as EformsignApiDocumentResponse);
}

@Injectable()
export class EformsignBackupService {
    constructor(@Inject(EFORMSIGN_BACKUP_REPOSITORY) private readonly repository: IEformsignBackupRepository) {}

    async listDocuments(cursor: number | undefined, limit: number) {
        const rows = await this.repository.listDocuments(cursor, limit);
        const items = rows.map((row) => {
            const kind = backupDocumentKind(row);
            const start = kind === "service_record" ? row.serviceRecordCase?.startDate
                : kind === "contract"
                    ? row.employeeSchedule?.startDate ?? row.client?.startDate ?? payloadStartDate(row.detailPayload)
                    : null;
            const chunk = row.serviceRecordSnapshotChunk;
            const completed = isCompletedStatus(row.statusType);
            return {
                docId: row.documentId, kind, title: row.documentName, customerName: row.customerName,
                serviceStartDate: start?.toISOString().slice(0, 10) ?? null,
                createdAt: row.createdDate.toISOString(),
                serviceRecordChunk: chunk ? {
                    caseId: chunk.serviceRecordCaseId, snapshotVersion: chunk.snapshotVersion,
                    chunkIndex: chunk.chunkIndex, chunkCount: chunk.chunkCount, firstSessionIndex: chunk.firstSessionIndex,
                } : null,
                completed,
                files: isBackupReadySync(row.statusType, row.syncStatus) ? row.files
                    .filter((file) => file.sourceUpdatedDate.getTime() === row.detailSourceUpdatedDate?.getTime())
                    .map((file) => ({ fileId: file.id, fileType: file.fileType, sha256: file.sha256, byteSize: file.byteSize })) : [],
            };
        });
        return { items, nextCursor: rows.length === limit ? rows[rows.length - 1]?.id ?? null : null };
    }

    async getFile(fileId: string) {
        const file = await this.repository.findFile(fileId);
        const doc = file?.eformsignDoc;
        if (!file || !doc || !isBackupReadySync(doc.statusType, doc.syncStatus)
            || doc.permanentPurgeRequestedAt !== null
            || file.sourceUpdatedDate.getTime() !== doc.detailSourceUpdatedDate?.getTime()) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        return { buffer: Buffer.from(file.content), sha256: file.sha256 };
    }

    createRun(input: Omit<BackupRunInput, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string }) {
        return this.repository.createRun({
            ...input, startedAt: new Date(input.startedAt), finishedAt: new Date(input.finishedAt),
            failures: input.failures.slice(0, 200),
        });
    }

    async listRuns(limit: number) {
        const rows = await this.repository.listRuns(limit);
        return { items: rows.map((row) => ({
            id: row.id, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString(),
            status: row.status, limited: row.limited, totalDocs: row.totalDocs, savedFiles: row.savedFiles,
            skippedFiles: row.skippedFiles, failedFiles: row.failedFiles, driveStatus: row.driveStatus,
            failures: row.failures as BackupFailure[],
        })) };
    }
}
