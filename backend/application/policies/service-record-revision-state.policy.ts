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
    // A case with no current revision is the legacy path. A non-null usable
    // pointer or revision-bearing job contradicts that identity and must not
    // be allowed to downgrade the source to `not_required`.
    if (facts.currentRevisionId === null) {
        if (facts.currentUsableRevisionId !== null || Boolean(job && job.revisionId !== null)) {
            return "unknown";
        }
        return "not_required";
    }
    if (!job || job.revisionId === null) return "unknown";
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPlannedDates(
    dates: unknown,
    count: unknown,
): boolean {
    if (!Array.isArray(dates)) return false;
    if (count === null) return dates.length === 0;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return false;
    if (dates.length !== count) return false;
    const seen = new Set<number>();
    return dates.every((entry: unknown) => {
        if (!isRecord(entry)) return false;
        const { sessionIndex, serviceDate } = entry;
        if (typeof sessionIndex !== "number" || !Number.isInteger(sessionIndex) || sessionIndex < 1) return false;
        if (typeof serviceDate !== "string" || !DATE_PATTERN.test(serviceDate)) return false;
        if (seen.has(sessionIndex)) return false;
        seen.add(sessionIndex);
        return true;
    }) && [...seen].sort((a, b) => a - b).every((index, position) => index === position + 1);
}

export function isValidServiceRecordDispatchContext(
    context: unknown,
): context is ServiceRecordRevisionDispatchContext {
    if (!isRecord(context)) return false;
    const { branchId, serviceRecordCaseId, clientId, revisionId, revisionNumber,
        businessFingerprint, formVersion, documentSyncStatus, lifecycleStatus, plannedSessionDates, plannedSessionCount } = context;
    if (typeof branchId !== "string" || !branchId
        || typeof serviceRecordCaseId !== "string" || !serviceRecordCaseId
        || typeof clientId !== "number" || !Number.isInteger(clientId) || clientId < 1) {
        return false;
    }
    if (revisionId !== null && (typeof revisionId !== "string" || !revisionId)) return false;
    if (revisionNumber !== null && (typeof revisionNumber !== "number"
        || !Number.isInteger(revisionNumber) || revisionNumber < 1)) {
        return false;
    }
    if (typeof businessFingerprint !== "string" || !FINGERPRINT_PATTERN.test(businessFingerprint)) return false;
    if (typeof formVersion !== "number" || !Number.isInteger(formVersion) || formVersion < 1) return false;
    if (typeof lifecycleStatus !== "string" || !lifecycleStatus) return false;
    if (!SERVICE_RECORD_REVISION_DOCUMENT_SYNC_STATUSES.some(status => status === documentSyncStatus)) return false;
    return isValidPlannedDates(plannedSessionDates, plannedSessionCount);
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
    // Every revision-bound context passed here is refused, regardless of its
    // contract-stage label or worker-supplied pending/completed status.
    // INITIAL_FINALIZATION jobs identified from stored rows are authorized on
    // a separate path via isInitialFinalizationJobIdentity and never reach
    // this function. Legacy jobs continue through their existing path.
    return isValidServiceRecordDispatchContext(context)
        && context.revisionId === null
        && context.documentSyncStatus !== "unknown"
        && context.documentSyncStatus !== "capability_unverified";
}
