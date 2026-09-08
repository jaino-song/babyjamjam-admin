import type {
    ServiceRecordDispatchAuthorizationResult,
    ServiceRecordRevisionDispatchContext,
    ServiceRecordRevisionDocumentSyncStatus,
} from "@babyjamjam/shared/types/service-record";

/**
 * Dispatch state is intentionally finite. Unknown provider states must never
 * be treated as permission to send; adapters can surface them for manual
 * reconciliation instead.
 */
export const SERVICE_RECORD_REVISION_DOCUMENT_SYNC_STATUSES = [
    "not_required",
    "pending",
    "waiting_for_completion",
    "capability_unverified",
    "completed",
    "failed",
    "unknown",
] as const satisfies readonly ServiceRecordRevisionDocumentSyncStatus[];

/**
 * The only inputs accepted by the document-sync projection are rows read
 * under the service-record owning lock.  In particular, a worker's expected
 * status is deliberately absent: adapters must compare that expected context
 * with this projection instead of manufacturing an observed value from it.
 */
export interface ServiceRecordDocumentSyncFacts {
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    currentUsableDocumentVersion: number | null;
    revisionJob: {
        revisionId: string | null;
        payloadFingerprint: string | null;
        status: string;
        progressStep: string | null;
        completeness: "complete" | "partial" | null;
        manualReviewRequired: boolean;
    } | null;
}

/**
 * Derive document synchronization from the locked persisted source.  A job
 * row alone never proves completion; the current usable revision pointer and
 * document version must also point at the same complete revision. Any missing,
 * contradictory, or manually-reviewable evidence remains unknown.
 */
export function deriveServiceRecordDocumentSyncStatus(
    facts: ServiceRecordDocumentSyncFacts,
): ServiceRecordRevisionDocumentSyncStatus {
    const job = facts.revisionJob;
    if (!job) return "unknown";
    if (job.revisionId === null) return "not_required";
    if (
        typeof job.revisionId !== "string"
        || job.revisionId.length === 0
        || typeof job.payloadFingerprint !== "string"
        || !FINGERPRINT_PATTERN.test(job.payloadFingerprint)
        || job.completeness !== "complete"
        || job.manualReviewRequired
    ) {
        return "unknown";
    }
    if (
        facts.currentRevisionId !== job.revisionId
        || facts.currentUsableRevisionId !== job.revisionId
    ) {
        return "unknown";
    }
    if (
        facts.currentUsableDocumentVersion === null
        || !Number.isInteger(facts.currentUsableDocumentVersion)
        || facts.currentUsableDocumentVersion < 1
    ) {
        return "unknown";
    }

    switch (job.status) {
        case "queued":
            return "pending";
        case "processing":
        case "reconciling":
            return "waiting_for_completion";
        case "completed":
            return "completed";
        case "failed":
        case "requires_attention":
            return "failed";
        default:
            return "unknown";
    }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

function isValidPlannedDates(
    context: ServiceRecordRevisionDispatchContext,
): boolean {
    const dates = context.plannedSessionDates;
    if (!Array.isArray(dates)) return false;
    if (context.plannedSessionCount === null) return dates.length === 0;
    if (!Number.isInteger(context.plannedSessionCount) || context.plannedSessionCount < 1) return false;
    if (dates.length !== context.plannedSessionCount) return false;
    const seen = new Set<number>();
    return dates.every((entry) => {
        if (!Number.isInteger(entry.sessionIndex) || entry.sessionIndex < 1) return false;
        if (seen.has(entry.sessionIndex) || !DATE_PATTERN.test(entry.serviceDate)) return false;
        seen.add(entry.sessionIndex);
        return true;
    }) && [...seen].sort((a, b) => a - b).every((index, position) => index === position + 1);
}

export function isValidServiceRecordDispatchContext(
    context: ServiceRecordRevisionDispatchContext | null | undefined,
): context is ServiceRecordRevisionDispatchContext {
    if (!context) return false;
    if (!context.branchId || !context.serviceRecordCaseId || !Number.isInteger(context.clientId) || context.clientId < 1) {
        return false;
    }
    if (context.revisionId !== null && !context.revisionId) return false;
    if (context.revisionNumber !== null && (!Number.isInteger(context.revisionNumber) || context.revisionNumber < 1)) {
        return false;
    }
    if (!FINGERPRINT_PATTERN.test(context.businessFingerprint)) return false;
    if (!Number.isInteger(context.formVersion) || context.formVersion < 1) return false;
    if (!SERVICE_RECORD_REVISION_DOCUMENT_SYNC_STATUSES.includes(context.documentSyncStatus)) return false;
    return isValidPlannedDates(context);
}

/**
 * Compare a worker's captured context with the latest locked source. A branch
 * or case mismatch is a lost authorization; business-version differences are
 * stale work that may be re-evaluated by the adapter. Lifecycle-only version
 * bumps are deliberately absent from this comparison.
 */
export function authorizeServiceRecordDispatch(
    expected: ServiceRecordRevisionDispatchContext | null | undefined,
    observed: ServiceRecordRevisionDispatchContext | null | undefined,
): ServiceRecordDispatchAuthorizationResult {
    if (!isValidServiceRecordDispatchContext(expected) || !isValidServiceRecordDispatchContext(observed)) {
        return { kind: "lost", reason: "invalid_dispatch_context" };
    }
    if (
        expected.branchId !== observed.branchId
        || expected.clientId !== observed.clientId
        || expected.serviceRecordCaseId !== observed.serviceRecordCaseId
    ) {
        return { kind: "lost", reason: "ownership_changed" };
    }

    const sameDates = expected.plannedSessionDates.length === observed.plannedSessionDates.length
        && expected.plannedSessionDates.every((entry, index) => (
            entry.sessionIndex === observed.plannedSessionDates[index]?.sessionIndex
            && entry.serviceDate === observed.plannedSessionDates[index]?.serviceDate
        ));
    const sameBusinessState = expected.revisionId === observed.revisionId
        && expected.revisionNumber === observed.revisionNumber
        && expected.businessFingerprint === observed.businessFingerprint
        && expected.plannedSessionCount === observed.plannedSessionCount
        && sameDates
        && expected.documentSyncStatus === observed.documentSyncStatus
        && expected.formVersion === observed.formVersion;

    return sameBusinessState
        ? { kind: "allow" }
        : { kind: "stale", reason: "revision_or_business_state_changed" };
}

export function isRevisionDocumentDispatchAllowed(
    context: ServiceRecordRevisionDispatchContext | null | undefined,
): boolean {
    // Phase0 capability is still unverified. Every revision-bound operation
    // must remain manual-review only, regardless of the contract-stage label
    // or a worker-supplied pending/completed status. Legacy jobs have no
    // revision identity and continue through their existing path.
    return isValidServiceRecordDispatchContext(context)
        && context.revisionId === null
        && context.documentSyncStatus !== "unknown"
        && context.documentSyncStatus !== "capability_unverified";
}
