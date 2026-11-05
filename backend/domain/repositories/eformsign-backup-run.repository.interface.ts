import type {
    EnqueueManualBackupInput, ManualBackupRunRecord, ManualBackupDocumentRecord, ManualBackupLeaseIdentity,
    ManualBackupDocumentResult, ManualBackupFinishInput,
} from "../eformsign-backup/manual-backup-run";
import type { ExportFileType } from "../eformsign-backup/export/constants";

export interface ManualBackupSourceDocument {
    readonly documentId: string;
    readonly branchId: string;
    readonly documentKind: string | null;
    readonly serviceRecordCaseId: string | null;
    readonly templateId: string | null;
    readonly createdDate: Date;
    readonly updatedDate: Date;
    readonly statusType: string;
    readonly stepType: string;
    readonly stepIndex: string;
    readonly voidedAt: Date | null;
    readonly permanentPurgeRequestedAt: Date | null;
    readonly detailPayloadIsNull: boolean;
}
export interface ManualBackupSourceFile {
    readonly documentId: string;
    readonly fileType: ExportFileType;
    readonly sha256: string;
    readonly byteSize: number;
}
export interface ManualBackupSource {
    readonly observedAt: Date;
    readonly documents: readonly ManualBackupSourceDocument[];
    readonly files: readonly ManualBackupSourceFile[];
}
export interface ManualBackupRunPageInput {
    readonly companyId: string;
    readonly branchId: string;
    readonly limit: number;
    readonly cursor?: { readonly createdAt: Date; readonly id: string };
}
export interface ManualBackupDocumentPageInput {
    readonly companyId: string;
    readonly branchId: string;
    readonly runId: string;
    readonly afterOrdinal: number;
    readonly limit: number;
}
export interface ManualBackupPage<T> { readonly items: readonly T[]; readonly hasMore: boolean }
export interface EformsignBackupRunRepository {
    readSourceForRequest(branchId: string, range?: { readonly gte?: Date; readonly lt?: Date }): Promise<ManualBackupSource>;
    enqueue(input: EnqueueManualBackupInput): Promise<{ readonly run: ManualBackupRunRecord; readonly replayed: boolean }>;
    findForBranch(companyId: string, branchId: string, id: string): Promise<ManualBackupRunRecord | null>;
    listForBranch(input: ManualBackupRunPageInput): Promise<ManualBackupPage<ManualBackupRunRecord>>;
    listDocumentsForBranch(input: ManualBackupDocumentPageInput): Promise<ManualBackupPage<ManualBackupDocumentRecord>>;
    claimNext(companyId: string, principalId: string): Promise<ManualBackupRunRecord | null>;
    heartbeat(identity: ManualBackupLeaseIdentity): Promise<boolean>;
    findClaimed(identity: ManualBackupLeaseIdentity): Promise<ManualBackupRunRecord | null>;
    listClaimedDocuments(identity: ManualBackupLeaseIdentity, afterOrdinal: number, limit: number): Promise<ManualBackupPage<ManualBackupDocumentRecord>>;
    writeDocumentResults(identity: ManualBackupLeaseIdentity, results: readonly ManualBackupDocumentResult[]): Promise<boolean>;
    finish(identity: ManualBackupLeaseIdentity, input: ManualBackupFinishInput): Promise<boolean>;
    expireStale(companyId: string): Promise<number>;
}
