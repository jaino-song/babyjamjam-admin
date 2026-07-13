import { api } from "@/lib/api/client";
import type { AlimtalkProvider } from "@/services/api";
import type {
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpdateMessageTriggerRuleDto,
} from "../types";

export const messageTriggersApi = {
    list: () => api.get<MessageTriggerRule[]>("/message-trigger-rules"),
    getById: (id: string) => api.get<MessageTriggerRule>(`/message-trigger-rules/${id}`),
    create: (dto: CreateMessageTriggerRuleDto) =>
        api.post<MessageTriggerRule>("/message-trigger-rules", dto),
    update: (id: string, dto: UpdateMessageTriggerRuleDto) =>
        api.patch<MessageTriggerRule>(`/message-trigger-rules/${id}`, dto),
    delete: (id: string) => api.delete(`/message-trigger-rules/${id}`),
    listTemplates: (params: {
        provider: Exclude<AlimtalkProvider, "none">;
        eventType?: TriggerEventType;
        recipientType?: TriggerRecipientType;
    }) =>
        api.get<TriggerTemplateCatalogItem[]>("/message-trigger-templates", {
            params,
        }),
};
