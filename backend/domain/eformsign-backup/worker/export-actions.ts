import { WorkerError, type WorkerReasonCode } from "./worker-error";

/** Where the failing call happened; a 401/404 means a different run outcome in each (contract §5). */
export type ExportStage = "snapshot" | "download";

export interface ExportErrorInput {
    /** HTTP status; `0` for a network failure or timeout (no response). */
    httpStatus: number;
    /** Export error code (`RATE_LIMITED`, ...), or `NETWORK` when there was no response. */
    code: string;
    stage?: ExportStage;
}

export interface ExportAction {
    /** What happens to the destination entry of the artifact whose download failed. */
    destinationAction: "retry_wait" | "blocked" | "terminal_unless_held" | "integrity_error" | "unchanged";
    /** What happens to the candidate. */
    candidateAction: "retryable" | "blocked" | "terminal_unavailable" | "unchanged";
    /** What the run does next. */
    runAction:
        | "continue"
        | "stop_downloads"
        | "stop_downloads_after_3_consecutive"
        | "poll_snapshot"
        | "fail_run"
        | "block_run";
    reasonCode: WorkerReasonCode;
}

/** Retry-later failures that do not touch the candidate. */
function transient(reasonCode: WorkerReasonCode, runAction: ExportAction["runAction"]): ExportAction {
    return { destinationAction: "retry_wait", candidateAction: "unchanged", runAction, reasonCode };
}
function blockedBy(reasonCode: WorkerReasonCode): ExportAction {
    return { destinationAction: "blocked", candidateAction: "blocked", runAction: "continue", reasonCode };
}
function failRun(reasonCode: WorkerReasonCode): ExportAction {
    return { destinationAction: "unchanged", candidateAction: "unchanged", runAction: "fail_run", reasonCode };
}

const BY_CODE: Readonly<Record<string, ExportAction>> = {
    RATE_LIMITED: transient("rate-limited", "stop_downloads"),
    ARTIFACT_PENDING: { destinationAction: "retry_wait", candidateAction: "retryable", runAction: "continue", reasonCode: "artifact-pending" },
    MIRROR_MISSING: { destinationAction: "retry_wait", candidateAction: "retryable", runAction: "continue", reasonCode: "mirror-missing" },
    EXPORT_UNAVAILABLE: transient("export-unavailable", "stop_downloads_after_3_consecutive"),
    INTERNAL: transient("export-unavailable", "stop_downloads_after_3_consecutive"),
    NETWORK: transient("network-timeout", "stop_downloads_after_3_consecutive"),
    VERSION_CHANGED: blockedBy("version-changed"),
    CONSISTENCY_CONFLICT: blockedBy("consistency-conflict"),
    ARTIFACT_TOO_LARGE: blockedBy("artifact-too-large"),
    SOURCE_REMOVED: {
        destinationAction: "terminal_unless_held", candidateAction: "terminal_unavailable",
        runAction: "continue", reasonCode: "source-removed",
    },
    SNAPSHOT_EXPIRED: {
        destinationAction: "unchanged", candidateAction: "unchanged", runAction: "stop_downloads", reasonCode: "snapshot-expired",
    },
    SNAPSHOT_NOT_READY: {
        destinationAction: "unchanged", candidateAction: "unchanged", runAction: "poll_snapshot", reasonCode: "snapshot-not-ready",
    },
    SNAPSHOT_FAILED: failRun("export-unavailable"),
    IDEMPOTENCY_CONFLICT: failRun("idempotency-conflict"),
    INVALID_REQUEST: failRun("export-request-rejected"),
    INVALID_CURSOR: failRun("export-request-rejected"),
    CURSOR_PARAMETER_MISMATCH: failRun("export-request-rejected"),
    UNSUPPORTED_REVISION: failRun("export-request-rejected"),
};

function credentialRejected(stage: ExportStage): ExportAction {
    return {
        destinationAction: "unchanged", candidateAction: "unchanged",
        runAction: stage === "snapshot" ? "fail_run" : "block_run", reasonCode: "credential-rejected",
    };
}

/** Contract §5 export-response table. Every input maps to an action with a non-null reason code. */
export function actionForExportError(input: ExportErrorInput): ExportAction {
    const stage = input.stage ?? "download";
    if (input.httpStatus === 0 || input.code === "NETWORK") return { ...BY_CODE["NETWORK"]! };
    if (input.code === "UNAUTHORIZED" || input.code === "NOT_FOUND") return credentialRejected(stage);
    const known = Object.prototype.hasOwnProperty.call(BY_CODE, input.code) ? BY_CODE[input.code] : undefined;
    if (known) return { ...known };
    // Unknown code: decide by status class, never by body text.
    if (input.httpStatus === 401 || input.httpStatus === 404) return credentialRejected(stage);
    if (input.httpStatus === 429) return { ...BY_CODE["RATE_LIMITED"]! };
    if (input.httpStatus >= 500 && input.httpStatus <= 599) return { ...BY_CODE["EXPORT_UNAVAILABLE"]! };
    if (input.httpStatus >= 400 && input.httpStatus <= 499) return failRun("export-request-rejected");
    return failRun("export-response-invalid");
}

/** Contract §5 last row: bytes whose hash or length differ from the candidate. */
export const BYTES_MISMATCH_ACTION: ExportAction = {
    destinationAction: "integrity_error", candidateAction: "unchanged", runAction: "continue", reasonCode: "artifact-integrity",
};

const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 21_600;
/** A server can ask for any wait; honouring more than a week would only park the entry forever. */
const RETRY_AFTER_MAX_SECONDS = 7 * 24 * 60 * 60;

/** `min(60 * 2^(attempt-1), 21600)` seconds for attempt 1, 2, ...; no randomness. */
export function backoffSeconds(attempt: number): number {
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new WorkerError("internal");
    return Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.min(attempt - 1, 20), BACKOFF_MAX_SECONDS);
}

/** `now + max(retryAfterSeconds, backoff)`, as a UTC ISO string. A missing or invalid `retryAfterSeconds` is ignored; it is capped at 7 days. */
export function nextRetryAt(now: Date | string, attempt: number, retryAfterSeconds?: number | null): string {
    const base = (now instanceof Date ? now : new Date(now)).getTime();
    if (Number.isNaN(base)) throw new WorkerError("internal");
    const retryAfter = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(Math.ceil(retryAfterSeconds), RETRY_AFTER_MAX_SECONDS) : 0;
    const at = new Date(base + Math.max(retryAfter, backoffSeconds(attempt)) * 1000);
    if (Number.isNaN(at.getTime())) throw new WorkerError("internal");
    return at.toISOString();
}
