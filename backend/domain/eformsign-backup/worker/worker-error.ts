/**
 * Closed set of reason codes the backup worker records, reports and maps (contract §2 W1-W8, §5).
 * Later units cannot edit this file, so every code any unit needs is listed here.
 */
export const WORKER_REASON_CODES = [
    "forbidden-transition",
    "ledger-seq-gap",
    "ledger-first-record",
    "ledger-schema",
    "ledger-checksum",
    "ledger-duplicate-install",
    "ledger-inconsistent",
    "invalid-path-segment",
    "control-unavailable",
    "control-space",
    "archive-unavailable",
    "archive-conflict",
    "archive-unsafe-path",
    "archive-space",
    "archive-identity-mismatch",
    "archive-marker-invalid",
    "unsupported-filesystem",
    "artifact-integrity",
    "integrity-repeated",
    "pdf-shape",
    "token-file-invalid",
    "export-base-url-invalid",
    "export-response-invalid",
    "credential-rejected",
    "config-invalid",
    "lock-not-held",
    "not-initialized",
    "recovery-required",
    "restore-conflict",
    "restore-output-invalid",
    "crashed",
    "coverage-unverified",
    "drive-not-configured",
    "retry-exhausted-run",
    "snapshot-expired",
    "snapshot-not-ready",
    "exact-bytes-unavailable",
    "archive-not-mount-point",
    "source-removed",
    "version-changed",
    "consistency-conflict",
    "artifact-too-large",
    "rate-limited",
    "artifact-pending",
    "mirror-missing",
    "export-unavailable",
    "network-timeout",
    "export-request-rejected",
    "idempotency-conflict",
    "internal",
] as const;

export type WorkerReasonCode = typeof WORKER_REASON_CODES[number];

const REASON_CODE_SET: ReadonlySet<string> = new Set(WORKER_REASON_CODES);

export function isWorkerReasonCode(value: unknown): value is WorkerReasonCode {
    return typeof value === "string" && REASON_CODE_SET.has(value);
}

/** The one error type of the worker. The message is the reason code only, so no input value can leak through it. */
export class WorkerError extends Error {
    readonly reasonCode: WorkerReasonCode;

    constructor(reasonCode: WorkerReasonCode) {
        super(reasonCode);
        this.name = "WorkerError";
        this.reasonCode = reasonCode;
    }
}
