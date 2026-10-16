import type { CollectionAssessment } from "domain/eformsign-backup/collection-receipt";

export const EFORMSIGN_BACKUP_COLLECTION_REPOSITORY = "EFORMSIGN_BACKUP_COLLECTION_REPOSITORY";
export type CollectionDocumentType = "01" | "03" | "04";
export type CollectionOutcome = "succeeded" | "failed" | "interrupted";
export type CollectionFailureCode = "fetch-failed" | "invalid-page" | "run-failed" | "lease-lost"
    | "persistence-unhealthy" | "company-unconfigured" | "scan-unfinished";
export interface CollectionRunContext {
    configuredCompanyId: string | null;
    trigger: "reconciliation" | "operator-backfill";
    lockMode: "valkey" | "approved-unlocked";
}
export interface CollectionPageObservation {
    documentType: CollectionDocumentType;
    pass: 1 | 2;
    ordinal: number;
    startOffset: number;
    requestedLimit: number;
    returnedCount: number | null;
    totalCount: number | null;
    terminal: boolean | null;
    outcome: CollectionOutcome;
    failureCode: CollectionFailureCode | null;
}
export interface CollectionScanObservation {
    documentType: CollectionDocumentType;
    pass: 1 | 2;
    distinctIdCount: number;
    documentIdSetSha256: string;
}
export interface CollectionScanSummary {
    documentType: CollectionDocumentType;
    pass: 1 | 2;
    outcome: "pending" | CollectionOutcome;
    distinctIdCount: number | null;
    documentIdSetSha256: string | null;
    expectedPageCount: number | null;
    persistedPageCount: number;
    failureCode: CollectionFailureCode | null;
}
export interface CollectionScanSummaryV1 {
    version: 1;
    scans: CollectionScanSummary[];
    /** Candidate only: final acknowledgement is established after commit. */
    assessment: CollectionAssessment;
}
export interface CollectionRunStart extends CollectionRunContext {
    id: string;
    startedAt: Date;
    scanSummary: CollectionScanSummaryV1;
}
export interface CollectionRunFinish {
    id: string;
    outcome: "completed" | "failed" | "interrupted";
    finishedAt: Date;
    failureCode: CollectionFailureCode | null;
    scanSummary: CollectionScanSummaryV1;
}
/** Checked inside the transaction after acquiring the run row lock. */
export interface CollectionWriteGuard { isHealthy: () => boolean }
export interface IEformsignBackupCollectionRepository {
    begin(run: CollectionRunStart): Promise<void>;
    append(runId: string, page: CollectionPageObservation, guard: CollectionWriteGuard): Promise<void>;
    finish(run: CollectionRunFinish, guard: CollectionWriteGuard): Promise<void>;
}
export interface EformsignCollectionObserver {
    page(page: CollectionPageObservation): Promise<void>;
    scan(scan: CollectionScanObservation): Promise<void>;
    finish(outcome: CollectionOutcome, shouldContinue?: () => boolean): Promise<CollectionAssessment>;
}
