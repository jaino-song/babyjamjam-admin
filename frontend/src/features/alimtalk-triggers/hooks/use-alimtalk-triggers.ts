"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alimtalkTriggersApi } from "../api/alimtalk-triggers.api";
import { alimtalkTriggerKeys } from "./keys";
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

export function useAlimtalkTriggerRules() {
    return useQuery<AlimtalkTriggerRule[]>({
        queryKey: alimtalkTriggerKeys.list(),
        queryFn: () =>
            alimtalkTriggersApi.list().then((response) => normalizeArrayPayload<AlimtalkTriggerRule>(response.data)),
    });
}

export function useAlimtalkTriggerRule(id: string) {
    return useQuery<AlimtalkTriggerRule | null>({
        queryKey: alimtalkTriggerKeys.detail(id),
        queryFn: () =>
            alimtalkTriggersApi
                .getById(id)
                .then((response) => normalizeSinglePayload<AlimtalkTriggerRule>(response.data)),
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
        queryFn: () =>
            alimtalkTriggersApi
                .listTemplates(params)
                .then((response) => normalizeArrayPayload<TriggerTemplateCatalogItem>(response.data)),
        enabled: !!params.provider,
    });
}

export function useUpcomingAlimtalkJobs(limit = 200) {
    return useQuery<UpcomingAlimtalkJob[]>({
        queryKey: alimtalkTriggerKeys.upcoming(limit),
        queryFn: () =>
            alimtalkTriggersApi
                .listUpcomingJobs(limit)
                .then((response) => normalizeArrayPayload<UpcomingAlimtalkJob>(response.data)),
    });
}

export function useAlimtalkHistory(limit = 200) {
    return useQuery<AlimtalkHistoryRecord[]>({
        queryKey: alimtalkTriggerKeys.history(limit),
        queryFn: () =>
            alimtalkTriggersApi
                .listHistory(limit)
                .then((response) => normalizeArrayPayload<AlimtalkHistoryRecord>(response.data)),
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
