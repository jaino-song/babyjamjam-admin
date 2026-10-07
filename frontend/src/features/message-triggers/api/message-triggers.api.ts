import { api } from "@/lib/api/client";
import type {
    MessageLogRecord,
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    ClientUpcomingMessageTriggerJobsResponse,
    UpcomingMessageTriggerJob,
    UpdateMessageTriggerRuleDto,
    UpdateMessageTriggerRuleBranchActivationDto,
} from "../types";

/** One page of a single client's message history (`GET /message-logs/client/:clientId`). */
export interface ClientMessageHistoryPageTransport {
    items: MessageLogRecord[];
    page: {
        snapshotAt: string;
        nextCursor: string | null;
        hasMore: boolean;
    };
}

export const messageTriggersApi = {
    list: () => api.get<MessageTriggerRule[]>("/message-trigger-rules"),
    getById: (id: string) => api.get<MessageTriggerRule>(`/message-trigger-rules/${id}`),
    create: (dto: CreateMessageTriggerRuleDto) =>
        api.post<MessageTriggerRule>("/message-trigger-rules", dto),
    update: (id: string, dto: UpdateMessageTriggerRuleDto) =>
        api.patch<MessageTriggerRule>(`/message-trigger-rules/${id}`, dto),
    activateWithParent: (id: string) =>
        api.put<MessageTriggerRule>(
            `/message-trigger-rules/${id}/activation-with-parent`,
            { isActive: true, enableParent: true },
        ),
    updateBranchActivation: (id: string, dto: UpdateMessageTriggerRuleBranchActivationDto) =>
        api.put<MessageTriggerRule>(`/message-trigger-rules/${id}/branch-activation`, dto),
    delete: (id: string) => api.delete(`/message-trigger-rules/${id}`),
    listTemplates: (params: {
        eventType?: TriggerEventType;
        recipientType?: TriggerRecipientType;
    }) =>
        api.get<TriggerTemplateCatalogItem[]>("/message-trigger-templates", {
            params,
        }),
    listUpcomingJobs: (limit = 200) =>
        api.get<UpcomingMessageTriggerJob[]>("/message-trigger-jobs/upcoming", {
            params: { limit },
        }),
    listClientUpcomingJobs: (
        clientId: number,
        params: { limit?: number; cursor?: string | null } = {},
    ) =>
        api.get<ClientUpcomingMessageTriggerJobsResponse>(
            `/message-trigger-jobs/client/${encodeURIComponent(clientId)}/upcoming`,
            {
                params: {
                    limit: params.limit ?? 50,
                    ...(params.cursor ? { cursor: params.cursor } : {}),
                },
            },
        ),
    listHistory: (limit = 200) =>
        api.get<MessageLogRecord[]>("/message-logs", {
            params: { limit },
        }),
    listClientHistory: (
        clientId: number,
        params: { limit?: number; cursor?: string | null } = {},
    ) =>
        api.get<ClientMessageHistoryPageTransport>(
            `/message-logs/client/${encodeURIComponent(clientId)}`,
            {
                params: {
                    limit: params.limit ?? 50,
                    ...(params.cursor ? { cursor: params.cursor } : {}),
                },
            },
        ),
    retryHistory: (id: number) =>
        api.post<MessageLogRecord>(`/message-logs/${id}/retry`),
    cancelUpcomingJob: (id: string) =>
        api.post<{ id: string; status: "canceled" }>(`/message-trigger-jobs/${id}/cancel`),
};
