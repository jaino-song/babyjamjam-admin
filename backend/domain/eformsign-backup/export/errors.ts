import type { ExportErrorBody } from "./types";

/** Contract 3.6. */
export const EXPORT_ERRORS = {
    UNAUTHORIZED: { status: 401, retryable: false },
    NOT_FOUND: { status: 404, retryable: false },
    INVALID_REQUEST: { status: 400, retryable: false },
    INVALID_CURSOR: { status: 400, retryable: false },
    CURSOR_PARAMETER_MISMATCH: { status: 400, retryable: false },
    UNSUPPORTED_REVISION: { status: 400, retryable: false },
    IDEMPOTENCY_CONFLICT: { status: 409, retryable: false },
    SNAPSHOT_NOT_READY: { status: 409, retryable: true },
    SNAPSHOT_FAILED: { status: 409, retryable: false },
    SNAPSHOT_EXPIRED: { status: 410, retryable: false },
    ARTIFACT_PENDING: { status: 409, retryable: true },
    MIRROR_MISSING: { status: 409, retryable: true },
    VERSION_CHANGED: { status: 409, retryable: false },
    ARTIFACT_TOO_LARGE: { status: 409, retryable: false },
    CONSISTENCY_CONFLICT: { status: 409, retryable: false },
    SOURCE_REMOVED: { status: 410, retryable: false },
    RATE_LIMITED: { status: 429, retryable: true },
    EXPORT_UNAVAILABLE: { status: 503, retryable: true },
    INTERNAL: { status: 500, retryable: true },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type ExportErrorCode = keyof typeof EXPORT_ERRORS;

export class ExportError extends Error {
    readonly code: ExportErrorCode;
    readonly reasonCode: string | undefined;
    readonly retryAfterSeconds: number | undefined;

    constructor(code: ExportErrorCode, opts?: { reasonCode?: string; retryAfterSeconds?: number }) {
        // The message is the code only: nothing caller-supplied can leak through it.
        super(code);
        this.name = "ExportError";
        this.code = code;
        this.reasonCode = opts?.reasonCode;
        this.retryAfterSeconds = opts?.retryAfterSeconds;
    }
}

/** Only the contract keys; never the message or stack. */
export function toExportErrorBody(error: ExportError, requestId: string): ExportErrorBody {
    const body: ExportErrorBody = {
        code: error.code,
        retryable: EXPORT_ERRORS[error.code].retryable,
        requestId,
    };
    if (error.reasonCode !== undefined) body.reasonCode = error.reasonCode;
    if (error.retryAfterSeconds !== undefined) body.retryAfterSeconds = error.retryAfterSeconds;
    return body;
}
