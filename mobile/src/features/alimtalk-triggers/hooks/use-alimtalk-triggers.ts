"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alimtalkTriggersApi } from "../api/alimtalk-triggers.api";
import { alimtalkTriggerKeys } from "./keys";
import type {
    AlimtalkTriggerRule,
    CreateAlimtalkTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpdateAlimtalkTriggerRuleDto,
} from "../types";
import type { AlimtalkProvider } from "@/services/api";

export function useAlimtalkTriggerRules() {
    return useQuery<AlimtalkTriggerRule[]>({
        queryKey: alimtalkTriggerKeys.list(),
        queryFn: () => alimtalkTriggersApi.list().then((response) => response.data),
    });
}

export function useAlimtalkTriggerRule(id: string) {
    return useQuery<AlimtalkTriggerRule>({
        queryKey: alimtalkTriggerKeys.detail(id),
        queryFn: () => alimtalkTriggersApi.getById(id).then((response) => response.data),
        enabled: !!id,
    });
}

export function useAlimtalkTriggerTemplates(params: {
    provider: Exclude<AlimtalkProvider, "none">;
    eventType?: TriggerEventType;
    recipientType?: TriggerRecipientType;
}) {
    return useQuery<TriggerTemplateCatalogItem[]>({
        queryKey: alimtalkTriggerKeys.templates(params.provider, params.eventType, params.recipientType),
        queryFn: () => alimtalkTriggersApi.listTemplates(params).then((response) => response.data),
        enabled: !!params.provider,
    });
}

export function useCreateAlimtalkTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateAlimtalkTriggerRuleDto) =>
            alimtalkTriggersApi.create(dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: alimtalkTriggerKeys.all });
        },
    });
}

export function useUpdateAlimtalkTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateAlimtalkTriggerRuleDto }) =>
            alimtalkTriggersApi.update(id, dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: alimtalkTriggerKeys.all });
        },
    });
}

export function useDeleteAlimtalkTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => alimtalkTriggersApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: alimtalkTriggerKeys.all });
        },
    });
}
