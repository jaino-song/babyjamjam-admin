/**
 * Persistence-layer errors for the administrator service-record editor.
 *
 * These errors deliberately do not depend on NestJS. The HTTP adapter in a
 * later task can translate the stable status/code pair to a 404 or 409 while
 * repository callers remain framework independent.
 */
export class ServiceRecordEditNotFoundError extends Error {
    readonly code: string = "SERVICE_RECORD_EDIT_NOT_FOUND";
    readonly statusCode = 404 as const;

    constructor(message = "Service-record edit resource was not found") {
        super(message);
        this.name = "ServiceRecordEditNotFoundError";
    }
}

export class ServiceRecordEditConflictError extends Error {
    readonly code: string = "SERVICE_RECORD_EDIT_CONFLICT";
    readonly statusCode = 409 as const;

    constructor(
        message = "The service-record edit changed before this operation completed",
    ) {
        super(message);
        this.name = "ServiceRecordEditConflictError";
    }
}

/** Named alias used by callers that want to distinguish a stale CAS version. */
export class ServiceRecordEditDraftConflictError extends ServiceRecordEditConflictError {
    readonly code = "SERVICE_RECORD_EDIT_DRAFT_CONFLICT";

    constructor(message = "The service-record draft version is stale") {
        super(message);
        this.name = "ServiceRecordEditDraftConflictError";
    }
}

/**
 * A current-revision external document operation is still unresolved, so a new
 * confirmation must wait.  Carries the blocking operation so callers can tell
 * the client which document is holding the record.
 */
export class ServiceRecordRevisionOperationUnresolvedError extends ServiceRecordEditConflictError {
    readonly code = "SERVICE_RECORD_REVISION_OPERATION_UNRESOLVED";

    constructor(
        message: string,
        readonly operation: string,
        readonly status: string,
        readonly lastErrorCode: string | null,
    ) {
        super(message);
        this.name = "ServiceRecordRevisionOperationUnresolvedError";
    }
}

/**
 * Error codes written ONLY when a revision operation is created already in
 * `manual_review` because its provider facts could not be captured at confirm
 * time.  Such a state never had a provider job, so it must not block the next
 * confirmation.  Shared by the confirm planner and the repository guard.
 */
export const SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE = "SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE";
export const SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE = "SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE";
export const SERVICE_RECORD_BORN_STUCK_ERROR_CODES = [
    SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE,
    SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE,
] as const;

export type ServiceRecordBornStuckErrorCode = (typeof SERVICE_RECORD_BORN_STUCK_ERROR_CODES)[number];
