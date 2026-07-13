"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import type {
    MessageLogRecord,
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpcomingMessageTriggerJob,
    UpdateMessageTriggerRuleDto,
} from "../types";
import type { AlimtalkProvider } from "@/services/api";

function normalizeArrayPayload<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) {
        return payload as T[];
    }

    if (payload !== null && typeof payload === "object" && "data" in payload) {
        const nestedData = (payload as Record<string, unknown>).data;
        if (Array.isArray(nestedData)) {
            return nestedData as T[];
        }
    }

    return [];
}

function normalizeSinglePayload<T>(payload: unknown): T | null {
    if (payload !== null && typeof payload === "object" && "data" in payload) {
        const nestedData = (payload as Record<string, unknown>).data;
        if (nestedData !== null && typeof nestedData === "object") {
            return nestedData as T;
        }
    }

    if (payload !== null && typeof payload === "object") {
        return payload as T;
    }

    return null;
}

export function useMessageTriggerRules() {
    return useQuery<MessageTriggerRule[]>({
        queryKey: messageTriggerKeys.list(),
        queryFn: () =>
            messageTriggersApi.list().then((response) => normalizeArrayPayload<MessageTriggerRule>(response.data)),
    });
}

export function useMessageTriggerRule(id: string) {
    return useQuery<MessageTriggerRule | null>({
        queryKey: messageTriggerKeys.detail(id),
        queryFn: () =>
            messageTriggersApi
                .getById(id)
                .then((response) => normalizeSinglePayload<MessageTriggerRule>(response.data)),
        enabled: !!id,
    });
}

export function useMessageTriggerTemplates(params: {
    provider: Exclude<AlimtalkProvider, "none">;
    eventType?: TriggerEventType;
    recipientType?: TriggerRecipientType;
}) {
    return useQuery<TriggerTemplateCatalogItem[]>({
        queryKey: messageTriggerKeys.templates(params.provider, params.eventType, params.recipientType),
        queryFn: () =>
            messageTriggersApi
                .listTemplates(params)
                .then((response) => normalizeArrayPayload<TriggerTemplateCatalogItem>(response.data)),
        enabled: !!params.provider,
    });
}

export function useUpcomingMessageTriggerJobs(limit = 200) {
    return useQuery<UpcomingMessageTriggerJob[]>({
        queryKey: messageTriggerKeys.upcoming(limit),
        queryFn: () =>
            messageTriggersApi
                .listUpcomingJobs(limit)
                .then((response) => normalizeArrayPayload<UpcomingMessageTriggerJob>(response.data)),
        staleTime: 0,
        refetchOnMount: "always",
    });
}

export function useMessageHistory(limit = 200) {
    return useQuery<MessageLogRecord[]>({
        queryKey: messageTriggerKeys.history(limit),
        queryFn: () =>
            messageTriggersApi
                .listHistory(limit)
                .then((response) => normalizeArrayPayload<MessageLogRecord>(response.data)),
    });
}

export function useCreateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateMessageTriggerRuleDto) =>
            messageTriggersApi.create(dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

export function useUpdateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateMessageTriggerRuleDto }) =>
            messageTriggersApi.update(id, dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

export function useDeleteMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => messageTriggersApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
        },
    });
}
