import type { AdminServiceRecordCaseSummary } from "@babyjamjam/shared/types/service-record";

export function withServiceRecordCase(path: string, caseId?: string): string {
    return caseId === undefined ? path : `${path}?caseId=${encodeURIComponent(caseId)}`;
}

export function serviceRecordEditorPath(clientId: string | number, caseId?: string): string {
    return withServiceRecordCase(`/service-record-admin/${encodeURIComponent(String(clientId))}`, caseId);
}

export function serviceRecordEditorApiPath(clientId: string, caseId?: string): string {
    return withServiceRecordCase(`/api/admin/service-records/client/${encodeURIComponent(clientId)}/editor`, caseId);
}

const KOREAN_ORDINALS = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째", "아홉째", "열째"];

export function serviceRecordCaseLabel(record: Pick<AdminServiceRecordCaseSummary, "rank" | "legacyName">): string {
    if (record.rank === null) return record.legacyName?.trim() || "기존 제공기록지";
    return KOREAN_ORDINALS[record.rank - 1] ?? `${record.rank}번째 아기`;
}
