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
const PROVIDER_CONTRACT_TEMPLATE = "제공인력 계약서";

function providerContractDetail(payload: unknown): Partial<EformsignApiDocumentResponse> | null {
    const detail = payload as Partial<EformsignApiDocumentResponse> | null;
    return detail?.template?.name === PROVIDER_CONTRACT_TEMPLATE ? detail : null;
}

function backupDocumentKind(row: BackupDocumentRow): BackupDocumentKind {
    if (row.documentKind === "service_record_snapshot") return "service_record";
    if (row.documentKind === "contract") return "contract";
    if (row.documentKind !== null) return "other";
    if (providerContractDetail(row.detailPayload)) return "other";
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

function providerContractMetadata(detailPayload: unknown) {
    const detail = providerContractDetail(detailPayload);
    if (!Array.isArray(detail?.fields)) return undefined;
    const fields = detail.fields;

    const readField = (id: string) => {
        const values = new Set(fields.filter((field) => field?.id === id)
            .map(({ value }) => typeof value === "string" ? value.trim() : ""));
        return values.size === 1 ? values.values().next().value : undefined;
    };
    const signerName = readField("제공인력 성명");
    const year = readField("계약년");
    const month = readField("계약월");
    const day = readField("계약일");
    if (!signerName || !signerName.replace(/[/\\:*?"<>|\u0000-\u001f\u007f .]/g, "").trim()
        || !year || !/^(?:20)?\d{2}$/.test(year)
        || !month || !/^\d{1,2}$/.test(month)
        || !day || !/^\d{1,2}$/.test(day)) return undefined;

    const signedDate = `20${year.slice(-2)}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(signedDate);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== signedDate) return undefined;
    return { signerName, signedDate };
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
            const providerContract = kind === "other" ? providerContractMetadata(row.detailPayload) : undefined;
            return {
                docId: row.documentId, kind, title: row.documentName, customerName: row.customerName,
                serviceStartDate: start?.toISOString().slice(0, 10) ?? null,
                createdAt: row.createdDate.toISOString(),
                serviceRecordChunk: chunk ? {
                    caseId: chunk.serviceRecordCaseId, snapshotVersion: chunk.snapshotVersion,
                    chunkIndex: chunk.chunkIndex, chunkCount: chunk.chunkCount, firstSessionIndex: chunk.firstSessionIndex,
                } : null,
                completed,
                ...(providerContract ? { providerContract } : {}),
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
