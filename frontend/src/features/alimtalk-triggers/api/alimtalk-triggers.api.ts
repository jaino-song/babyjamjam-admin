import { api } from "@/lib/api/client";
import type {
    AlimtalkHistoryRecord,
    AlimtalkTriggerRule,
    CreateAlimtalkTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpcomingAlimtalkJob,
    UpdateAlimtalkTriggerRuleDto,
} from "../types";
import type { AlimtalkProvider } from "@/services/api";

export const alimtalkTriggersApi = {
    list: () => api.get<AlimtalkTriggerRule[]>("/alimtalk-trigger-rules"),
    getById: (id: string) => api.get<AlimtalkTriggerRule>(`/alimtalk-trigger-rules/${id}`),
    create: (dto: CreateAlimtalkTriggerRuleDto) =>
        api.post<AlimtalkTriggerRule>("/alimtalk-trigger-rules", dto),
    update: (id: string, dto: UpdateAlimtalkTriggerRuleDto) =>
        api.patch<AlimtalkTriggerRule>(`/alimtalk-trigger-rules/${id}`, dto),
    delete: (id: string) => api.delete(`/alimtalk-trigger-rules/${id}`),
    listTemplates: (params: {
        provider: Exclude<AlimtalkProvider, "none">;
        eventType?: TriggerEventType;
        recipientType?: TriggerRecipientType;
    }) =>
        api.get<TriggerTemplateCatalogItem[]>("/alimtalk-trigger-templates", {
            params,
        }),
    listUpcomingJobs: (limit = 200) =>
        api.get<UpcomingAlimtalkJob[]>("/alimtalk-trigger-jobs/upcoming", {
            params: { limit },
        }),
    listHistory: (limit = 200) =>
        api.get<AlimtalkHistoryRecord[]>("/alimtalk-logs", {
            params: { limit },
        }),
};
