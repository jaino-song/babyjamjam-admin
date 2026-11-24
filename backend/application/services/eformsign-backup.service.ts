import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { extractEformsignContractStartDate } from "application/utils/eformsign-contract-client-candidate";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES, EFORMSIGN_REVIEW_STAGE_STATUS_STORAGE_VALUES, TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    BACKUP_READY_DOC_ID, BACKUP_READY_RETENTION_MS, BackupDocumentRow, BackupFailure, BackupRunInput,
    EFORMSIGN_BACKUP_REPOSITORY, IEformsignBackupRepository,
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

function backupDocument(row: BackupDocumentRow) {
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
}

function hasReadyFiles(doc: ReturnType<typeof backupDocument>) {
    const documents = doc.files.filter(({ fileType }) => fileType === "document");
    const audits = doc.files.filter(({ fileType }) => fileType === "audit_trail");
    return doc.files.every(({ sha256, byteSize }) => /^[a-f0-9]{64}$/i.test(sha256) && byteSize > 0)
        && documents.length === 1 && audits.length <= 1 && (!doc.completed || audits.length === 1);
}

@Injectable()
export class EformsignBackupService {
    constructor(@Inject(EFORMSIGN_BACKUP_REPOSITORY) private readonly repository: IEformsignBackupRepository) {}

    async listDocuments(cursor: number | undefined, limit: number) {
        const rows = await this.repository.listDocuments(cursor, limit);
        const items = rows.map(backupDocument);
        return { items, nextCursor: rows.length === limit ? rows[rows.length - 1]?.id ?? null : null };
    }

    async listReadyEvents(since: Date, until: Date, afterId: number, limit: number) {
        const span = until.getTime() - since.getTime();
        if (!(span > 0 && span <= BACKUP_READY_RETENTION_MS)) {
            throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
        }
        const rows = await this.repository.listReadyEvents(since, until, afterId, limit);
        const items = rows.flatMap(({ id, documentId, rawStatus, statusType, sourceUpdatedDate, createdAt }) =>
            documentId && BACKUP_READY_DOC_ID.test(documentId) ? [{
                id, docId: documentId, completed: rawStatus === "doc_complete" || isCompletedStatus(statusType ?? ""),
                sourceUpdatedAt: sourceUpdatedDate?.toISOString() ?? null, createdAt: createdAt.toISOString(),
            }] : []);
        return { items, nextCursor: rows.length === limit ? rows.at(-1)?.id ?? null : null };
    }

    async findReadyDocuments(docId: string) {
        const target = await this.repository.findReadyTarget(docId);
        if (!target) return { status: "pending", sourceUpdatedAt: null, items: [] };
        const { seed, peers } = target;
        const sourceUpdatedAt = seed.detailSourceUpdatedDate?.toISOString() ?? null;
        if (seed.permanentPurgeRequestedAt || (!isCompletedStatus(seed.statusType) && !isReviewStageStatus(seed.statusType)
            && TERMINAL_STATUS_CODES.has(normalizeEformsignStatusCode(seed.statusType)))) {
            return { status: "ineligible", sourceUpdatedAt, items: [] };
        }
        const doc = backupDocument(seed);
        if (!hasReadyFiles(doc)) return { status: "pending", sourceUpdatedAt, items: [] };
        const items = [doc, ...peers.map(backupDocument)].filter(hasReadyFiles)
            .sort((a, b) => (a.serviceRecordChunk?.firstSessionIndex ?? 0) - (b.serviceRecordChunk?.firstSessionIndex ?? 0)
                || (a.docId < b.docId ? -1 : Number(a.docId > b.docId)));
        return { status: "ready", sourceUpdatedAt, items };
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
