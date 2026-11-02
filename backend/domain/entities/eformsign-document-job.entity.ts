export const EFORMSIGN_DOCUMENT_JOB_TYPES = ["create_document", "finalize_document"] as const;
export const EFORMSIGN_DOCUMENT_JOB_SOURCES = ["staff", "auto_finalize"] as const;
export const EFORMSIGN_DOCUMENT_JOB_STATUSES = [
    "queued",
    "processing",
    "reconciling",
    "completed",
    "failed",
    "requires_attention",
] as const;

export type EformsignDocumentJobType = (typeof EFORMSIGN_DOCUMENT_JOB_TYPES)[number];
export type EformsignDocumentJobSource = (typeof EFORMSIGN_DOCUMENT_JOB_SOURCES)[number];
export type EformsignDocumentJobStatus = (typeof EFORMSIGN_DOCUMENT_JOB_STATUSES)[number];
export type EformsignDocumentJobPayload = Record<string, unknown>;

// Shared, immutable revision generation input consumed by the record
// renderer. Re-exporting it from the job entity keeps adapter imports on the
// existing domain boundary instead of reaching into package internals.
export type { ServiceRecordRevisionGenerationInput } from "@babyjamjam/shared/types/service-record";

export interface EformsignDocumentJobProps {
    id: string;
    branchId: string;
    clientId: number | null;
    documentId: string | null;
    jobType: EformsignDocumentJobType;
    source: EformsignDocumentJobSource;
    status: EformsignDocumentJobStatus;
    requestKey: string;
    activeKey: string | null;
    payload: EformsignDocumentJobPayload | null;
    payloadFingerprint: string | null;
    progressStep: string | null;
    attempts: number;
    nextAttemptAt: Date;
    heartbeatAt: Date | null;
    leaseToken: string | null;
    autoFinalizeOutcomeRecordedAt: Date | null;
    autoFinalizeOutcomeAttempts: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    lastErrorCode: string | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    /** Display name from the joined client row; only the list/recovery queries fill it. */
    clientName?: string | null;
}

export class EformsignDocumentJobEntity implements EformsignDocumentJobProps {
    constructor(props: EformsignDocumentJobProps) {
        Object.assign(this, props);
    }

    declare readonly id: string;
    declare readonly branchId: string;
    declare readonly clientId: number | null;
    declare readonly documentId: string | null;
    declare readonly jobType: EformsignDocumentJobType;
    declare readonly source: EformsignDocumentJobSource;
    declare readonly status: EformsignDocumentJobStatus;
    declare readonly requestKey: string;
    declare readonly activeKey: string | null;
    declare readonly payload: EformsignDocumentJobPayload | null;
    declare readonly payloadFingerprint: string | null;
    declare readonly progressStep: string | null;
    declare readonly attempts: number;
    declare readonly nextAttemptAt: Date;
    declare readonly heartbeatAt: Date | null;
    declare readonly leaseToken: string | null;
    declare readonly autoFinalizeOutcomeRecordedAt: Date | null;
    declare readonly autoFinalizeOutcomeAttempts: number | null;
    declare readonly startedAt: Date | null;
    declare readonly completedAt: Date | null;
    declare readonly lastErrorCode: string | null;
    declare readonly createdByUserId: string | null;
    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
    declare readonly clientName?: string | null;
}

/**
 * `progress_step` value the dispatch authorization writes. It proves exclusivity
 * (one live owner may drive the headless browser) and nothing else: it is NOT send
 * evidence. Ordering of the dispatch markers is
 * null < dispatch_authorized < creating < sent; only `creating`/`sent` mean the
 * eformsign "전송" button may have been clicked.
 */
export const DISPATCH_AUTHORIZED_PROGRESS_STEP = "dispatch_authorized";

/** `progress_step` value of a job that staff resolved by hand in the eformsign iframe. */
export const MANUAL_RESOLVED_PROGRESS_STEP = "manual_resolved";

const MANUAL_CLAIM_PREFIX = "manual_in_progress";
export const MANUAL_CLAIM_TTL_MS = 10 * 60_000;
// Mirrors the regex the repository applies in SQL before it casts the expiry.
const MANUAL_CLAIM_PATTERN = /^manual_in_progress:([^:]+):([0-9]{1,15})$/;

export interface ManualRecoveryClaim {
    userId: string;
    expiresAtMs: number;
}

/** The one place that renders a manual-recovery claim into `progress_step`. */
export function buildManualClaimStep(userId: string, nowMs: number): string {
    return `${MANUAL_CLAIM_PREFIX}:${userId}:${nowMs + MANUAL_CLAIM_TTL_MS}`;
}

/** The one place that reads a manual-recovery claim back; `null` for any other value. */
export function parseManualClaim(progressStep: string | null | undefined): ManualRecoveryClaim | null {
    if (!progressStep) return null;
    const match = MANUAL_CLAIM_PATTERN.exec(progressStep);
    if (!match) return null;
    const expiresAtMs = Number(match[2]);
    return Number.isSafeInteger(expiresAtMs) ? { userId: match[1]!, expiresAtMs } : null;
}

export type ContractJobShape = Pick<
    EformsignDocumentJobProps,
    "source" | "jobType" | "requestKey" | "payload"
>;

/**
 * A staff contract job: the create/finalize jobs a staff member started from the
 * contract flow. Service-record revision jobs share the table and the job types
 * but are not contract jobs. Keep in step with the SQL fragment of the same name
 * in the repository.
 */
export function isContractJob(job: ContractJobShape): boolean {
    return job.source === "staff"
        && (job.jobType === "create_document" || job.jobType === "finalize_document")
        && !job.requestKey.startsWith("service-record-")
        && (job.payload === null || !Object.prototype.hasOwnProperty.call(job.payload, "kind"));
}

export type RecoveryClassification = "manual_send" | "verify_result";

/**
 * What staff may do with a stuck contract job. `failed` is only reached before
 * anything was sent, so a manual send is safe. `requires_attention` can follow a
 * send that may have happened, so staff verify the result instead of resending.
 */
export function classifyRecovery(
    job: ContractJobShape & Pick<EformsignDocumentJobProps, "status" | "progressStep">,
): RecoveryClassification | null {
    if (job.progressStep === MANUAL_RESOLVED_PROGRESS_STEP) return null;
    if (!isContractJob(job)) return null;
    if (job.status === "failed") return "manual_send";
    if (job.status === "requires_attention") return "verify_result";
    return null;
}
