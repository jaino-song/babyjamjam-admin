import { api } from "@/lib/api/client";
import type {
    PrepareServiceRecordLinkResponse,
    SendServiceRecordLinkRequest,
    SendServiceRecordLinkResponse,
    ServiceRecordOverview,
} from "../types";

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`),
    prepareLink: (scheduleId: number) =>
        api.post<PrepareServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/prepare-link`,
            {},
        ),
    sendLink: (scheduleId: number, request: SendServiceRecordLinkRequest = {}) =>
        api.post<SendServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            request,
        ),
};
