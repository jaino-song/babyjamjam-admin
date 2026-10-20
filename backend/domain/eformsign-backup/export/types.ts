import type { ExportCounts } from "./classification";
import type { ExportClassification, ExportFileType } from "./constants";
import type { ExportErrorCode } from "./errors";

/** The authenticated machine caller, shared by the guard, service and controller. */
export type ExportPrincipal = {
    credentialId: string;
    principalId: string;
    companyIds: readonly string[];
};

export type ExportSnapshotStatus = "building" | "ready" | "failed";

/** Contract 3.2. */
export interface ExportSnapshotView {
    snapshotId: string;
    status: ExportSnapshotStatus;
    companyId: string;
    scopeRevision: string;
    policyRevision: string;
    createdAt: string;
    readyAt: string | null;
    expiresAt: string | null;
    counts: ExportCounts;
    coverage: { status: "unverified"; reasonCode: "collection-receipt-unavailable" };
    backupComplete: false;
}

/** Contract 3.3. */
export interface ExportCandidateView {
    ordinal: number;
    documentId: string;
    classification: ExportClassification;
    reasons: string[];
    statusType: string;
    documentKind: string | null;
    metadataRevision: string;
    artifacts: Array<{
        fileType: ExportFileType;
        artifactIdentity: string;
        sha256: string;
        byteSize: number;
    }>;
}

export interface ExportCandidatePageView {
    snapshotId: string;
    items: ExportCandidateView[];
    nextCursor: string | null;
}

/** Contract 3.6. */
export interface ExportErrorBody {
    code: ExportErrorCode;
    retryable: boolean;
    requestId: string;
    reasonCode?: string;
    retryAfterSeconds?: number;
}
