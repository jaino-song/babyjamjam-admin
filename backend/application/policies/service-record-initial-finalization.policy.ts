export const INITIAL_FINALIZATION_REQUEST_PREFIX = "service-record-initial-finalization:";

// 완료 이력이 유실된 삭제는 재생성 허용 코드에 포함하지 않는다.
export const SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED = "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED";
export const SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN = "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN";

export function initialFinalizationRequestKey(revisionId: string): string {
    return `${INITIAL_FINALIZATION_REQUEST_PREFIX}${revisionId}`;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export function isInitialFinalizationJobIdentity(job: {
    jobType: unknown; source: unknown; documentId: unknown; requestKey: unknown; payload: unknown;
}): boolean {
    const payload = record(job.payload);
    const context = record(payload?.["context"]);
    const revisionId = payload?.["revisionId"];
    return job.jobType === "create_document"
        && job.source === "auto_finalize"
        && job.documentId === null
        && payload?.["kind"] === "service_record_revision"
        && payload["generationKind"] === "INITIAL_FINALIZATION"
        && typeof revisionId === "string" && revisionId.length > 0
        && context?.["revisionId"] === revisionId
        && job.requestKey === initialFinalizationRequestKey(revisionId)
        && payload["snapshotReference"] === job.requestKey;
}

export function isInitialFinalizationWorkflowScope(scope: unknown, requestKey: string): boolean {
    const value = record(scope);
    return value?.["generationKind"] === "INITIAL_FINALIZATION" && value["requestKey"] === requestKey;
}
