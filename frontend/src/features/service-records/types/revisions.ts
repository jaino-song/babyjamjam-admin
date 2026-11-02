import {
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES,
} from "@babyjamjam/shared/types/service-record";
import type {
    ServiceRecordCaregiverEditChangesResponse,
    ServiceRecordCaregiverEditSummary,
    ServiceRecordRevisionChangeValue,
    ServiceRecordRevisionChangesResponse,
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionFieldChange,
    ServiceRecordRevisionHistoryEntry,
    ServiceRecordRevisionHistoryResponse,
    ServiceRecordRevisionSessionChange,
} from "@babyjamjam/shared/types/service-record";

export {
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES,
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS as SERVICE_RECORD_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES as SERVICE_RECORD_DOCUMENT_STATUSES,
};
export type {
    ServiceRecordCaregiverEditChangesResponse,
    ServiceRecordCaregiverEditSummary,
    ServiceRecordRevisionChangeValue,
    ServiceRecordRevisionChangesResponse,
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionFieldChange,
    ServiceRecordRevisionHistoryEntry,
    ServiceRecordRevisionHistoryResponse,
    ServiceRecordRevisionSessionChange,
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

    // Caregiver edits are optional on the wire (older servers omit them).
    if (value.caregiverEdits !== undefined && value.caregiverEdits !== null && !Array.isArray(value.caregiverEdits)) {
        throw new Error("Invalid service-record revision history response: caregiverEdits");
    }
    const caregiverEdits = (value.caregiverEdits ?? []).map(normalizeCaregiverEditSummary);

    return {
        caseId: requiredString(value.caseId, "caseId"),
        caseVersion: nonNegativeInteger(value.caseVersion, "caseVersion"),
        currentRevisionId,
        currentUsableRevisionId,
        revisions,
        caregiverEdits,
    };
}

function normalizeCaregiverEditSummary(value: unknown): ServiceRecordCaregiverEditSummary {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record revision history response: caregiverEdit");
    }
    // Only these fields cross the boundary, so a payload can never ride along.
    return {
        id: requiredString(value.id, "caregiverEdit.id"),
        editedAt: normalizeDate(value.editedAt, "caregiverEdit.editedAt"),
        sessionIndex: positiveInteger(value.sessionIndex, "caregiverEdit.sessionIndex"),
        employeeName: requiredString(value.employeeName, "caregiverEdit.employeeName"),
    };
}

const REVISION_SESSION_CHANGE_KINDS = ["added", "removed", "changed"] as const;

function normalizeChangeValue(value: unknown, field: string): ServiceRecordRevisionChangeValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
    throw new Error(`Invalid service-record revision changes response: ${field}`);
}

function nullableDateOnly(value: unknown, field: string): string | null {
    if (value === null) return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Invalid service-record revision changes response: ${field}`);
    }
    return value;
}

function normalizeFieldChange(value: unknown): ServiceRecordRevisionFieldChange {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record revision changes response: change");
    }
    return {
        path: requiredString(value.path, "change.path"),
        before: normalizeChangeValue(value.before, "change.before"),
        after: normalizeChangeValue(value.after, "change.after"),
    };
}

function normalizeFieldChanges(value: unknown, field: string): ServiceRecordRevisionFieldChange[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid service-record revision changes response: ${field}`);
    }
    return value.map(normalizeFieldChange);
}

function normalizeSessionChange(value: unknown): ServiceRecordRevisionSessionChange {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record revision changes response: session");
    }
    const kind = value.kind;
    if (typeof kind !== "string"
        || !REVISION_SESSION_CHANGE_KINDS.includes(kind as (typeof REVISION_SESSION_CHANGE_KINDS)[number])) {
        throw new Error("Invalid service-record revision changes response: session.kind");
    }
    return {
        sessionIndex: positiveInteger(value.sessionIndex, "session.sessionIndex"),
        kind: kind as ServiceRecordRevisionSessionChange["kind"],
        serviceDateBefore: nullableDateOnly(value.serviceDateBefore, "session.serviceDateBefore"),
        serviceDateAfter: nullableDateOnly(value.serviceDateAfter, "session.serviceDateAfter"),
        changes: normalizeFieldChanges(value.changes, "session.changes"),
    };
}

export function normalizeServiceRecordRevisionChanges(
    value: unknown,
): ServiceRecordRevisionChangesResponse {
    if (!isRecord(value) || typeof value.beforeAvailable !== "boolean") {
        throw new Error("Invalid service-record revision changes response");
    }
    if (!Array.isArray(value.sessions)) {
        throw new Error("Invalid service-record revision changes response: sessions");
    }
    return {
        revisionId: requiredString(value.revisionId, "revisionId"),
        revisionNumber: positiveInteger(value.revisionNumber, "revisionNumber"),
        confirmedAt: normalizeDate(value.confirmedAt, "confirmedAt"),
        formVersion: positiveInteger(value.formVersion, "formVersion"),
        beforeAvailable: value.beforeAvailable,
        basicInfo: normalizeFieldChanges(value.basicInfo, "basicInfo"),
        sessions: value.sessions.map(normalizeSessionChange),
    };
}

export function normalizeServiceRecordCaregiverEditChanges(
    value: unknown,
): ServiceRecordCaregiverEditChangesResponse {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record caregiver edit changes response");
    }
    return {
        editId: requiredString(value.editId, "editId"),
        editedAt: normalizeDate(value.editedAt, "editedAt"),
        employeeName: requiredString(value.employeeName, "employeeName"),
        session: normalizeSessionChange(value.session),
    };
}
