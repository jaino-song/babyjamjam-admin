export const EFORMSIGN_BACKUP_REPOSITORY = "EFORMSIGN_BACKUP_REPOSITORY";

export interface BackupFailure { docId: string; reason: string }
export interface BackupRunInput {
    startedAt: Date;
    finishedAt: Date;
    status: "success" | "partial" | "failed";
    limited: boolean;
    totalDocs: number;
    savedFiles: number;
    skippedFiles: number;
    failedFiles: number;
    driveStatus: "ok" | "failed" | "skipped";
    failures: BackupFailure[];
}
export interface BackupRunRow extends Omit<BackupRunInput, "status" | "driveStatus" | "failures"> {
    id: string;
    status: string;
    driveStatus: string;
    failures: unknown;
}
export interface BackupDocumentRow {
    id: number;
    documentId: string;
    documentKind: string | null;
    documentName: string | null;
    statusType: string;
    detailPayload: unknown;
    customerName: string | null;
    createdDate: Date;
    syncStatus: string;
    detailSourceUpdatedDate: Date | null;
    serviceRecordCase: { startDate: Date | null } | null;
    employeeSchedule: { startDate: Date | null } | null;
    client: { startDate: Date | null } | null;
    serviceRecordSnapshotChunk: {
        serviceRecordCaseId: string; snapshotVersion: number;
        chunkIndex: number; chunkCount: number; firstSessionIndex: number;
    } | null;
    files: {
        id: string; fileType: string; sha256: string; byteSize: number; sourceUpdatedDate: Date;
    }[];
}
export interface BackupFileRow {
    content: Uint8Array;
    sha256: string;
    sourceUpdatedDate: Date;
    eformsignDoc: {
        statusType: string; permanentPurgeRequestedAt: Date | null;
        syncStatus: string; detailSourceUpdatedDate: Date | null;
    };
}
export const BACKUP_READY_DOC_ID = /^[^\s\p{Cc}]+$/u;
export const BACKUP_READY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface BackupReadyEventRow {
    id: number;
    documentId: string | null;
    rawStatus: string | null;
    statusType: string | null;
    sourceUpdatedDate: Date | null;
    createdAt: Date;
}
export interface BackupReadyTarget {
    seed: BackupDocumentRow & { permanentPurgeRequestedAt: Date | null };
    peers: BackupDocumentRow[];
}

export interface IEformsignBackupRepository {
    listReadyEvents(since: Date, until: Date, afterId: number, limit: number): Promise<BackupReadyEventRow[]>;
    findReadyTarget(docId: string): Promise<BackupReadyTarget | null>;
    listDocuments(cursor: number | undefined, limit: number): Promise<BackupDocumentRow[]>;
    findFile(fileId: string): Promise<BackupFileRow | null>;
    createRun(input: BackupRunInput): Promise<{ id: string }>;
    listRuns(limit: number): Promise<BackupRunRow[]>;
}
