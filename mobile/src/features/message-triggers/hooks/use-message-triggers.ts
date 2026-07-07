"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AlimtalkProvider } from "@/services/api";

import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import type {
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpdateMessageTriggerRuleDto,
} from "../types";

export function useMessageTriggerRules() {
    return useQuery<MessageTriggerRule[]>({
        queryKey: messageTriggerKeys.list(),
        queryFn: () => messageTriggersApi.list().then((response) => response.data),
    });
}

export function useMessageTriggerRule(id: string) {
    return useQuery<MessageTriggerRule>({
        queryKey: messageTriggerKeys.detail(id),
        queryFn: () => messageTriggersApi.getById(id).then((response) => response.data),
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
        queryFn: () => messageTriggersApi.listTemplates(params).then((response) => response.data),
        enabled: !!params.provider,
    });
}

export function useCreateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateMessageTriggerRuleDto) =>
            messageTriggersApi.create(dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
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
