import { api } from "@/lib/api/client";
import type {
    PrepareServiceRecordLinkRequest,
    PrepareServiceRecordLinkResponse,
    SendServiceRecordLinkRequest,
    SendServiceRecordLinkResponse,
    ServiceRecordOverview,
} from "../types";

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`),
    prepareLink: (scheduleId: number, request: PrepareServiceRecordLinkRequest = {}) =>
        api.post<PrepareServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/prepare-link`,
            request,
        ),
    sendLink: (scheduleId: number, request: SendServiceRecordLinkRequest = {}) =>
        api.post<SendServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            request,
        ),
};
