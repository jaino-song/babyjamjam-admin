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
