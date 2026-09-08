import {
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES,
} from "@babyjamjam/shared/types/service-record";
import type {
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryEntry,
    ServiceRecordRevisionHistoryResponse,
} from "@babyjamjam/shared/types/service-record";

export {
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES,
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS as SERVICE_RECORD_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES as SERVICE_RECORD_DOCUMENT_STATUSES,
};
export type {
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryEntry,
    ServiceRecordRevisionHistoryResponse,
};

export type RetryServiceRecordDocumentInput = {
    revisionId: string;
    documentStateId: string;
    expectedGeneration: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid service-record revision response: ${field}`);
    }
    return value;
}

function positiveInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Invalid service-record revision response: ${field}`);
    }
    return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid service-record revision response: ${field}`);
    }
    return value;
}

function positiveIntegerOrNull(value: unknown, field: string): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid service-record revision response: ${field}`);
    }
    return value;
}

function normalizeOperation(value: unknown): ServiceRecordRevisionDocumentOperation {
    if (typeof value !== "string"
        || !SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS.includes(
            value as (typeof SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS)[number],
        )) {
        throw new Error("Invalid service-record revision response: document.operation");
    }
    return value as ServiceRecordRevisionDocumentOperation;
}

function normalizeStatus(value: unknown): ServiceRecordRevisionDocumentStatus {
    return typeof value === "string"
        && SERVICE_RECORD_REVISION_DOCUMENT_STATUSES.includes(value as ServiceRecordRevisionDocumentStatus)
        ? value as ServiceRecordRevisionDocumentStatus
        : "unknown";
}

function normalizeReasonCode(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") return null;
    return /^[A-Z0-9][A-Z0-9_.:-]{0,79}$/.test(value) ? value : null;
}

function normalizeDate(value: unknown, field: string): string {
    const date = requiredString(value, field);
    if (Number.isNaN(Date.parse(date))) {
        throw new Error(`Invalid service-record revision response: ${field}`);
    }
    return date;
}

export function normalizeServiceRecordRevisionDocumentSummary(
    value: unknown,
): ServiceRecordRevisionDocumentSummary {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record revision document response");
    }
    return {
        id: requiredString(value.id, "document.id"),
        operation: normalizeOperation(value.operation),
        generation: requiredString(value.generation, "document.generation"),
        status: normalizeStatus(value.status),
        documentVersion: positiveIntegerOrNull(value.documentVersion, "document.documentVersion"),
        canRetry: value.canRetry === true,
        reasonCode: normalizeReasonCode(value.reasonCode),
    };
}

export function normalizeServiceRecordRevisionHistory(
    value: unknown,
): ServiceRecordRevisionHistoryResponse {
    if (!isRecord(value) || !Array.isArray(value.revisions)) {
        throw new Error("Invalid service-record revision history response");
    }

    const currentRevisionId = value.currentRevisionId === null || value.currentRevisionId === undefined
        ? null
        : requiredString(value.currentRevisionId, "currentRevisionId");
    const currentUsableRevisionId = value.currentUsableRevisionId === null || value.currentUsableRevisionId === undefined
        ? null
        : requiredString(value.currentUsableRevisionId, "currentUsableRevisionId");

    const revisions = value.revisions.map((revisionValue) => {
        if (!isRecord(revisionValue) || !Array.isArray(revisionValue.documents)) {
            throw new Error("Invalid service-record revision summary response");
        }
        return {
            id: requiredString(revisionValue.id, "revision.id"),
            revisionNumber: positiveInteger(revisionValue.revisionNumber, "revision.revisionNumber"),
            confirmedAt: normalizeDate(revisionValue.confirmedAt, "revision.confirmedAt"),
            isCurrent: revisionValue.isCurrent === true,
            documents: revisionValue.documents.map(normalizeServiceRecordRevisionDocumentSummary),
        };
    });

    return {
        caseId: requiredString(value.caseId, "caseId"),
        caseVersion: nonNegativeInteger(value.caseVersion, "caseVersion"),
        currentRevisionId,
        currentUsableRevisionId,
        revisions,
    };
}
