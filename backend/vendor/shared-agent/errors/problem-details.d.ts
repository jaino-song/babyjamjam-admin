/**
 * Public problem-details contract shared by browser and server code.
 *
 * This module deliberately has no runtime dependencies.  In particular, the
 * parser is a small allow-list validator instead of a Zod schema so the
 * backend can vendor the file without pulling the shared package's UI
 * dependencies into its runtime bundle.
 */
export type ErrorLocale = "ko-KR" | "en-US";
export type ProblemCode = "REQUEST_INVALID" | "VALIDATION_FAILED" | "AUTH_REQUIRED" | "ACCESS_DENIED" | "RESOURCE_NOT_FOUND" | "REQUEST_CONFLICT" | "METHOD_NOT_ALLOWED" | "REQUEST_EXPIRED" | "PAYLOAD_TOO_LARGE" | "MEDIA_TYPE_UNSUPPORTED" | "REQUEST_RATE_LIMITED" | "INTERNAL_ERROR" | "DEPENDENCY_UNAVAILABLE" | "UPSTREAM_INVALID_RESPONSE" | "UPSTREAM_TIMEOUT" | "CONTRACT_ALREADY_SIGNED" | "MESSAGE_SEND_NOT_STARTED" | "MESSAGE_SEND_UNCONFIRMED" | "MESSAGE_SEND_PARTIAL" | "MESSAGE_SEND_REJECTED" | "MESSAGE_SEND_ALREADY_REQUESTED" | "MESSAGE_REQUEST_KEY_CONFLICT" | "CLIENT_SERVICE_PERIOD_INVALID" | "CLIENT_SERVICE_PERIOD_UNCOMPUTABLE" | "CLIENT_DURATION_OUT_OF_RANGE" | "CLIENT_DURATION_NEEDS_SERVICE_PERIOD" | "CLIENT_SERVICE_STATUS_INVALID" | "CLIENT_AREA_UNAVAILABLE";
export type ProblemOutcome = "NOT_APPLIED" | "FAILED" | "PARTIALLY_APPLIED" | "UNKNOWN";
export type RecoveryAction = "CHECK_STATUS" | "NONE";
export type RetryMode = "NEVER";
export type ProblemErrorCode = "REQUIRED" | "INVALID_FORMAT" | "OUT_OF_RANGE" | "INVALID_VALUE" | "UNEXPECTED_FIELD";
export type ProblemErrorLocation = "body" | "query" | "path" | "custom";
export type ApiErrorOrigin = "server" | "transport" | "client";
export type ApiOperation = "read" | "mutation";
export interface ProblemError {
    pointer: string;
    code: ProblemErrorCode;
    detail: string;
    location?: ProblemErrorLocation;
}
export interface ProblemRecovery {
    action: RecoveryAction;
    retry: {
        mode: RetryMode;
    };
}
/**
 * `params` is intentionally empty in version one.  It is retained as an
 * extension point, but accepting values here would make server diagnostics a
 * public data channel before a future version defines those values safely.
 */
export interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    code: ProblemCode;
    requestId: string;
    params?: Record<string, never>;
    errors?: ProblemError[];
    outcome?: ProblemOutcome;
    operationId?: string;
    recovery?: ProblemRecovery;
}
export interface ProblemCatalogEntry {
    code: ProblemCode;
    type: string;
    /** Canonical status used when a caller does not provide one. */
    status: number;
    /** Every status accepted by the public contract for this code. */
    statuses: readonly number[];
    /** Alias kept descriptive for backend consumers that prefer this name. */
    allowedStatuses: readonly number[];
    title: Readonly<Record<ErrorLocale, string>>;
    detail: Readonly<Record<ErrorLocale, string>>;
    fieldErrors: Readonly<Record<ErrorLocale, Readonly<Record<ProblemErrorCode, string>>>>;
}
export interface CreateProblemDetailsInput {
    code: ProblemCode;
    requestId: string;
    locale?: ErrorLocale;
    status?: number;
    params?: Record<string, never>;
    errors?: ProblemError[];
    outcome?: ProblemOutcome;
    operationId?: string;
    recovery?: ProblemRecovery;
}
export interface NormalizeApiErrorOptions {
    operation?: ApiOperation;
    locale?: ErrorLocale;
}
export interface NormalizedApiError {
    origin: ApiErrorOrigin;
    verified: boolean;
    message: string;
    canceled: boolean;
    /** True only when a read cancellation should be hidden from the UI. */
    suppress: boolean;
    problem?: ProblemDetails;
    status?: number;
    originalCode?: string;
    originalType?: string;
    outcome?: ProblemOutcome;
    recovery?: ProblemRecovery;
    /** Non-enumerable compatibility aliases for UI callers. */
    isCanceled?: boolean;
    shouldSuppress?: boolean;
}
export interface ResolveProblemMessageOptions {
    locale?: ErrorLocale;
    operation?: ApiOperation;
}
export declare const PROBLEM_TYPE_BASE_URI = "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#";
export declare const PROBLEM_CATALOG: Readonly<Record<ProblemCode, ProblemCatalogEntry>>;
/** Lower-case alias for consumers that prefer a value-style catalog name. */
export declare const problemCatalog: Readonly<Record<ProblemCode, ProblemCatalogEntry>>;
/** Generic alias kept for callers that import the contract's “catalog”. */
export declare const catalog: Readonly<Record<ProblemCode, ProblemCatalogEntry>>;
/**
 * Validate and sanitize a server-supplied problem-details payload.
 * Unknown extension members are ignored.  Known text fields are always
 * replaced by the catalog copy, so server internals cannot reach a UI.
 */
export declare function parseProblemDetails(value: unknown, httpStatus?: number, locale?: ErrorLocale): ProblemDetails | null;
/**
 * Build a problem from caller-owned facts.  No request id, outcome, or
 * operation id is generated here; callers must provide each value they want
 * published.
 */
export declare function createProblemDetails(input: CreateProblemDetailsInput): ProblemDetails;
export declare function createProblemDetails(code: ProblemCode, requestId: string, options?: Omit<CreateProblemDetailsInput, "code" | "requestId">): ProblemDetails;
/**
 * Normalize server, transport, and local errors into one safe result.  A
 * malformed response is never promoted to a fabricated ProblemDetails object.
 */
export declare function normalizeApiError(error: unknown, options?: NormalizeApiErrorOptions): NormalizedApiError;
/**
 * Resolve a message solely from the registered catalog or a centralized safe
 * fallback.  Incoming title/detail strings and legacy message translations
 * are intentionally ignored.
 */
export declare function resolveProblemMessage(value: unknown, localeOrOptions?: ErrorLocale | ResolveProblemMessageOptions): string;
export declare const SAFE_UNKNOWN_PROBLEM_MESSAGES: Readonly<Record<ErrorLocale, string>>;
export declare const SAFE_READ_FAILURE_MESSAGES: Readonly<Record<ErrorLocale, string>>;
export declare const SAFE_MUTATION_FAILURE_MESSAGES: Readonly<Record<ErrorLocale, string>>;
