"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
import { messageTriggersApi, type ClientMessageHistoryPageTransport } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import type {
    MessageLogRecord,
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    ClientUpcomingMessageTriggerJob,
    ClientUpcomingMessageTriggerJobsResponse,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpcomingMessageTriggerJob,
    UpdateMessageTriggerRuleDto,
    UpdateMessageTriggerRuleBranchActivationDto,
} from "../types";

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

function normalizeClientUpcomingPayload(payload: unknown): ClientUpcomingMessageTriggerJobsResponse {
    const candidate = payload !== null && typeof payload === "object" && "data" in payload
        ? (payload as { data?: unknown }).data
        : payload;
    if (!candidate || typeof candidate !== "object") {
        return { items: [], nextCursor: null };
    }

    const value = candidate as { items?: unknown; nextCursor?: unknown };
    const items = Array.isArray(value.items) ? value.items as ClientUpcomingMessageTriggerJob[] : [];
    return {
        items,
        nextCursor: typeof value.nextCursor === "string" && value.nextCursor.length > 0
            ? value.nextCursor
            : null,
    };
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
    eventType?: TriggerEventType;
    recipientType?: TriggerRecipientType;
}) {
    return useQuery<TriggerTemplateCatalogItem[]>({
        queryKey: messageTriggerKeys.templates("sms", params.eventType, params.recipientType),
        queryFn: () =>
            messageTriggersApi
                .listTemplates(params)
                .then((response) => normalizeArrayPayload<TriggerTemplateCatalogItem>(response.data)),
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
        refetchInterval: (query) =>
            query.state.data?.some((job) => job.status === "processing") ? 1_000 : 5_000,
    });
}

export function useClientUpcomingMessageTriggerJobs(
    clientId: number | null,
    options: { enabled?: boolean; limit?: number } = {},
) {
    const limit = options.limit ?? 50;
    const enabled = (options.enabled ?? true)
        && Number.isSafeInteger(clientId)
        && (clientId ?? 0) > 0;
    const query = useInfiniteQuery<ClientUpcomingMessageTriggerJobsResponse, Error>({
        queryKey: messageTriggerKeys.clientUpcoming(clientId ?? 0),
        initialPageParam: null,
        queryFn: ({ pageParam }) =>
            messageTriggersApi
                .listClientUpcomingJobs(clientId as number, {
                    limit,
                    cursor: typeof pageParam === "string" ? pageParam : null,
                })
                .then((response) => normalizeClientUpcomingPayload(response.data)),
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        enabled,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    const items = query.isError
        ? []
        : Array.from(
            new Map(
                (query.data?.pages.flatMap((page) => page.items) ?? [])
                    .filter((job) => (
                        job.status === "pending"
                        || job.status === "processing"
                        || job.status === "dispatching"
                    ))
                    .map((job) => [job.id, job] as const),
            ).values(),
        );

    return {
        ...query,
        items,
    };
}

const CLIENT_HISTORY_CONTRACT_MESSAGE = "메시지 발송 기록 서버 응답 형식이 올바르지 않습니다.";

/**
 * Validates one page of a client's history. A response missing its envelope
 * (null data, no `items`, no `page`, a `hasMore` page without a cursor) is a
 * broken contract, not an empty history: it must surface as an error so the
 * panel never shows "내역 없음" for records it failed to read.
 */
function normalizeClientHistoryPayload(payload: unknown): ClientMessageHistoryPageTransport {
    const candidate = payload !== null && typeof payload === "object" && "data" in payload
        ? (payload as { data?: unknown }).data
        : payload;
    if (candidate === null || typeof candidate !== "object") {
        throw new Error(CLIENT_HISTORY_CONTRACT_MESSAGE);
    }

    const value = candidate as { items?: unknown; page?: unknown };
    if (!Array.isArray(value.items) || value.page === null || typeof value.page !== "object") {
        throw new Error(CLIENT_HISTORY_CONTRACT_MESSAGE);
    }

    const page = value.page as { snapshotAt?: unknown; nextCursor?: unknown; hasMore?: unknown };
    const hasNextCursor = typeof page.nextCursor === "string" && page.nextCursor.length > 0;
    if (
        typeof page.hasMore !== "boolean"
        || (page.nextCursor !== null && page.nextCursor !== undefined && !hasNextCursor)
        || (page.hasMore && !hasNextCursor)
        || (!page.hasMore && hasNextCursor)
    ) {
        throw new Error(CLIENT_HISTORY_CONTRACT_MESSAGE);
    }

    return {
        items: value.items as MessageLogRecord[],
        page: {
            snapshotAt: typeof page.snapshotAt === "string" ? page.snapshotAt : "",
            nextCursor: hasNextCursor ? (page.nextCursor as string) : null,
            hasMore: page.hasMore,
        },
    };
}

/**
 * One client's message history, read from the client-scoped endpoint instead of
 * the branch-wide `/message-logs` window (which only holds the branch's newest
 * rows, so an older client history used to read as "no messages").
 *
 * `hasNextPage` is true while the server still has older records; callers must
 * say so rather than present the loaded pages as the complete history.
 */
export function useClientMessageHistory(
    clientId: number | null,
    options: UseMessageHistoryOptions & { limit?: number } = {},
) {
    const limit = options.limit ?? 50;
    const enabled = (options.enabled ?? true)
        && Number.isSafeInteger(clientId)
        && (clientId ?? 0) > 0;
    const query = useInfiniteQuery<ClientMessageHistoryPageTransport, Error>({
        queryKey: messageTriggerKeys.clientHistory(clientId ?? 0),
        initialPageParam: null,
        queryFn: ({ pageParam }) =>
            messageTriggersApi
                .listClientHistory(clientId as number, {
                    limit,
                    cursor: typeof pageParam === "string" ? pageParam : null,
                })
                .then((response) => normalizeClientHistoryPayload(response.data)),
        getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
        enabled,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: options.refetchOnWindowFocus ?? true,
        refetchInterval: options.refetchInterval ?? 5_000,
    });

    const { isError, data } = query;
    const items = useMemo(
        () => isError
            ? []
            : Array.from(
                new Map(
                    (data?.pages.flatMap((page) => page.items) ?? [])
                        .map((record) => [record.id, record] as const),
                ).values(),
            ),
        [isError, data],
    );

    return {
        ...query,
        items,
    };
}

export interface UseMessageHistoryOptions {
    enabled?: boolean;
    refetchInterval?: number | false;
    refetchOnWindowFocus?: boolean;
}

export function useMessageHistory(limit = 200, options: UseMessageHistoryOptions = {}) {
    return useQuery<MessageLogRecord[]>({
        queryKey: messageTriggerKeys.history(limit),
        queryFn: () =>
            messageTriggersApi
                .listHistory(limit)
                .then((response) => normalizeArrayPayload<MessageLogRecord>(response.data)),
        enabled: options.enabled ?? true,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: options.refetchOnWindowFocus ?? true,
        refetchInterval: options.refetchInterval ?? 5_000,
    });
}

export function useRetryMessageHistory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) =>
            messageTriggersApi.retryHistory(id).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
        },
    });
}

// Cancels a pending trigger job (POST /message-trigger-jobs/:id/cancel). The
// backend refuses anything but a still-pending job. Invalidates both upcoming
// and history so the canceled row moves from the 예정 zone into 지난 발송.
export function useCancelUpcomingMessageTriggerJob() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) =>
            messageTriggersApi.cancelUpcomingJob(id).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
        },
    });
}

export function useCreateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateMessageTriggerRuleDto) =>
            messageTriggersApi.create(dto).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

export function useUpdateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateMessageTriggerRuleDto }) =>
            messageTriggersApi.update(id, dto).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

export function useUpdateMessageTriggerRuleBranchActivation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateMessageTriggerRuleBranchActivationDto }) =>
            messageTriggersApi.updateBranchActivation(id, dto).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

/**
 * Enables one existing rule and its branch's trigger-dispatch parent in the
 * backend's single atomic operation. This deliberately has no fallback to the
 * ordinary rule update or branch activation mutations.
 */
export function useActivateMessageTriggerRuleWithParent() {
    const queryClient = useQueryClient();

    const isParentDisabledConflict = (error: unknown) => {
        if (!error || typeof error !== "object" || !("response" in error)) return false;
        const response = (error as { response?: { status?: unknown; data?: unknown } }).response;
        if (response?.status !== 409 || !response.data || typeof response.data !== "object") return false;
        const payload = response.data as { code?: unknown; error?: unknown };
        if (payload.code === "MESSAGE_AUTOMATION_PARENT_DISABLED") return true;
        return Boolean(
            payload.error &&
            typeof payload.error === "object" &&
            (payload.error as { code?: unknown }).code === "MESSAGE_AUTOMATION_PARENT_DISABLED",
        );
    };

    return useMutation({
        mutationFn: (id: string) =>
            messageTriggersApi.activateWithParent(id).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
            await queryClient.invalidateQueries({
                queryKey: ["settings", "message-automation-policies"],
            });
        },
        onError: async (error) => {
            if (!isParentDisabledConflict(error)) return;

            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            await queryClient.invalidateQueries({
                queryKey: ["settings", "message-automation-policies"],
            });
        },
    });
}

// Removes a rule from the cached rule list. Non-array shapes pass through unchanged.
function removeTriggerRuleFromCacheData(current: unknown, id: string): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as MessageTriggerRule[], id);
}

export function useDeleteMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation<unknown, Error, string, { previous: QuerySnapshot }>({
        mutationFn: (id: string) => messageTriggersApi.delete(id),
        onMutate: async (id) => {
            // Must target the exact rule-list key, never `messageTriggerKeys.all`:
            // that broad prefix also matches upcoming jobs, history, templates and
            // detail caches, whose differently-shaped rows can carry the same `id`.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                { queryKey: messageTriggerKeys.list() },
                (current) => removeTriggerRuleFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
        },
    });
}
