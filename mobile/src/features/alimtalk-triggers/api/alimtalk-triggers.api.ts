import { api } from "@/lib/api/client";
import type {
    AlimtalkTriggerRule,
    CreateAlimtalkTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
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
};
