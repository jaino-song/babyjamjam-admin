import { api } from "@/lib/api/client";
import {
    normalizeServiceRecordRevisionDocumentSummary,
    normalizeServiceRecordRevisionHistory,
} from "../types";
import type {
    ApplyServiceScheduleChangeRequest,
    ApplyServiceScheduleChangeResponse,
    PrepareServiceRecordLinkRequest,
    PrepareServiceRecordLinkResponse,
    ResetServiceRecordLinkResponse,
    SendServiceRecordLinkRequest,
    SendServiceRecordLinkResponse,
    ServiceScheduleChangePreviewResponse,
    ServiceRecordOverview,
    RetryServiceRecordDocumentInput,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryResponse,
} from "../types";

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`),
    getClientRevisionHistory: (clientId: number) =>
        api.get<unknown>(`/admin/service-records/clients/${encodeURIComponent(String(clientId))}/revisions`)
            .then((response) => ({
                ...response,
                data: normalizeServiceRecordRevisionHistory(response.data),
            } as typeof response & { data: ServiceRecordRevisionHistoryResponse })),
    retryRevisionDocument: ({ revisionId, documentStateId, expectedGeneration }: RetryServiceRecordDocumentInput) =>
        api.post<unknown>(
            `/admin/service-records/revisions/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(documentStateId)}/retry`,
            { expectedGeneration },
        ).then((response) => ({
            ...response,
            data: normalizeServiceRecordRevisionDocumentSummary(response.data),
        } as typeof response & { data: ServiceRecordRevisionDocumentSummary })),
    prepareLink: (scheduleId: number, request: PrepareServiceRecordLinkRequest = {}) =>
        api.post<PrepareServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/prepare-link`,
            request,
        ),
    resetLink: (scheduleId: number) =>
        api.post<ResetServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/reset-link`,
            {},
        ),
    previewScheduleChange: (scheduleId: number) =>
        api.get<ServiceScheduleChangePreviewResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/preview`,
        ),
    applyScheduleChange: (scheduleId: number, request: ApplyServiceScheduleChangeRequest) =>
        api.post<ApplyServiceScheduleChangeResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/apply`,
            request,
        ),
    sendLink: (scheduleId: number, request: SendServiceRecordLinkRequest = {}) =>
        api.post<SendServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            request,
        ),
};
