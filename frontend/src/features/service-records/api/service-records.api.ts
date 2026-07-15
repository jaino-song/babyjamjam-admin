import { api } from "@/lib/api/client";
import type { SendServiceRecordLinkResponse, ServiceRecordOverview } from "../types";

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`),
    sendLink: (scheduleId: number) =>
        api.post<SendServiceRecordLinkResponse>(`/admin/service-records/schedules/${scheduleId}/send-link`, {}),
};
