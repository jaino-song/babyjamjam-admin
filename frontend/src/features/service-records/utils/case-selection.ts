export { serviceRecordCaseLabel } from "@babyjamjam/shared/constants/service-record-display";

export function withServiceRecordCase(path: string, caseId?: string): string {
    return caseId === undefined ? path : `${path}?caseId=${encodeURIComponent(caseId)}`;
}

export function serviceRecordEditorPath(clientId: string | number, caseId?: string): string {
    return withServiceRecordCase(`/service-record-admin/${encodeURIComponent(String(clientId))}`, caseId);
}

export function serviceRecordEditorApiPath(clientId: string, caseId?: string): string {
    return withServiceRecordCase(`/api/admin/service-records/client/${encodeURIComponent(clientId)}/editor`, caseId);
}
