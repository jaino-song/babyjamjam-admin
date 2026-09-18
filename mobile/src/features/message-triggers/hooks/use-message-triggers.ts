"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
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

class MessageHistoryContractError extends Error {
    readonly retryable = false;

    constructor(message: string) {
        super(message);
        this.name = "MessageHistoryContractError";
    }
}

class MessageHistoryTransientError extends Error {
    readonly retryable = true;
    readonly attemptedPages: number;

    constructor(attemptedPages: number) {
        super("메시지 발송 기록을 불러오는 중 일시적인 오류가 발생했습니다. 잠시 후 자동으로 다시 시도합니다.");
        this.name = "MessageHistoryTransientError";
        this.attemptedPages = attemptedPages;
    }
}

function createAbortError(reason: unknown): Error {
    if (
        reason !== null
        && typeof reason === "object"
        && "name" in reason
        && (reason as { name?: unknown }).name === "AbortError"
    ) {
        return reason as Error;
    }

    const abortError = new Error(
        reason instanceof Error ? reason.message : "메시지 발송 기록 요청이 취소되었습니다.",
    );
    abortError.name = "AbortError";
    return abortError;
}

interface NormalizedMessageHistoryPage {
    items: MessageLogRecord[];
    snapshotAt: string;
    nextCursor: string | null;
    hasMore: boolean;
}

function normalizeMessageHistoryPage(payload: unknown): NormalizedMessageHistoryPage {
    if (payload === null || typeof payload !== "object") {
        throw new MessageHistoryContractError("메시지 발송 기록 서버 응답 형식이 올바르지 않습니다.");
    }

    const envelope = payload as Record<string, unknown>;
    const page = envelope.page;
    if (!Array.isArray(envelope.items) || page === null || typeof page !== "object") {
        throw new MessageHistoryContractError("메시지 발송 기록 서버 응답 형식이 올바르지 않습니다.");
    }

    const pageRecord = page as Record<string, unknown>;
    if (
        typeof pageRecord.snapshotAt !== "string"
        || Number.isNaN(new Date(pageRecord.snapshotAt).getTime())
        || typeof pageRecord.hasMore !== "boolean"
        || (pageRecord.nextCursor !== null && typeof pageRecord.nextCursor !== "string")
        || (typeof pageRecord.nextCursor === "string" && pageRecord.nextCursor.length === 0)
        || (!pageRecord.hasMore && pageRecord.nextCursor !== null)
    ) {
        throw new MessageHistoryContractError("메시지 발송 기록 서버 응답 형식이 올바르지 않습니다.");
    }

    for (const item of envelope.items) {
        if (
            item === null
            || typeof item !== "object"
            || !("id" in item)
            || (typeof (item as { id?: unknown }).id !== "string"
                && typeof (item as { id?: unknown }).id !== "number")
        ) {
            throw new MessageHistoryContractError("메시지 발송 기록 항목 형식이 올바르지 않습니다.");
        }
    }

    return {
        items: envelope.items as MessageLogRecord[],
        snapshotAt: pageRecord.snapshotAt,
        nextCursor: pageRecord.nextCursor as string | null,
        hasMore: pageRecord.hasMore,
    };
}

export const MESSAGE_HISTORY_REFRESH_INTERVAL_MS = 5_000;

export function getMessageHistoryRefetchInterval(
    recordCount: number | undefined,
    pageSize: number,
    attemptedPageCount = 0,
): number {
    const safePageSize = Math.max(pageSize, 1);
    const safeRecordCount = Math.max(recordCount ?? 0, 0);
    const estimatedPageRequests = Math.floor(safeRecordCount / safePageSize) + 1;
    const safeAttemptedPageCount = Math.max(attemptedPageCount, 1);

    return MESSAGE_HISTORY_REFRESH_INTERVAL_MS * Math.max(estimatedPageRequests, safeAttemptedPageCount);
}

async function fetchCompleteMessageHistory(
    limit: number,
    signal?: AbortSignal,
): Promise<MessageLogRecord[]> {
    const records: MessageLogRecord[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let snapshotAt: string | undefined;

    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
        if (signal?.aborted) {
            throw createAbortError(signal.reason);
        }
        if (cursor !== undefined) {
            if (seenCursors.has(cursor)) {
                throw new MessageHistoryContractError(
                    "메시지 발송 기록 페이지 커서가 반복되어 전체 기록을 확인할 수 없습니다.",
                );
            }
            seenCursors.add(cursor);
        }

        let response;
        try {
            response = await messageTriggersApi.listHistoryPage(limit, cursor, signal);
        } catch (error) {
            if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
                throw createAbortError(signal?.aborted ? signal.reason : error);
            }
            throw new MessageHistoryTransientError(pageIndex + 1);
        }
        const page = normalizeMessageHistoryPage(response.data);
        if (snapshotAt === undefined) {
            snapshotAt = page.snapshotAt;
        } else if (snapshotAt !== page.snapshotAt) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록 스냅샷이 변경되어 전체 기록을 확인할 수 없습니다.",
            );
        }
        if (page.hasMore && page.items.length === 0) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록 페이지가 비어 있어 전체 기록을 확인할 수 없습니다.",
            );
        }

        for (const record of page.items) {
            const recordId = String(record.id);
            if (seenIds.has(recordId)) {
                throw new MessageHistoryContractError(
                    "메시지 발송 기록에 중복된 항목이 있어 전체 기록을 확인할 수 없습니다.",
                );
            }

            seenIds.add(recordId);
            records.push(record);
        }

        if (records.length > 50_000) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다.",
            );
        }

        if (!page.hasMore) return records;
        if (page.nextCursor === null) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록 페이지 커서가 누락되어 전체 기록을 확인할 수 없습니다.",
            );
        }
        if (cursor !== undefined && page.nextCursor === cursor) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록 페이지 커서가 진행되지 않아 전체 기록을 확인할 수 없습니다.",
            );
        }
        if (pageIndex === 99) {
            throw new MessageHistoryContractError(
                "메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다.",
            );
        }
        cursor = page.nextCursor;
    }

    throw new MessageHistoryContractError(
        "메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다.",
    );
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

export function useMessageHistory(limit = 500) {
    return useQuery<MessageLogRecord[]>({
        queryKey: messageTriggerKeys.history(limit),
        queryFn: ({ signal }) => fetchCompleteMessageHistory(limit, signal),
        staleTime: 0,
        refetchOnMount: "always",
        // Complete-history refreshes make one sequential request per page.
        // Space a multi-page refresh across the same number of 5-second slots
        // as the previous single-page poll: two pages refresh every 10 seconds,
        // three pages every 15 seconds. Manual and mutation invalidations still
        // refetch immediately; a row can be stale for up to the scaled interval
        // (plus request time); transient failures retain the attempted-page
        // count so a late failure cannot restart a full walk every five seconds.
        retry: false,
        refetchInterval: (query) => {
            const error = query.state.error as {
                retryable?: boolean;
                name?: string;
                attemptedPages?: number;
            } | null;
            if (error?.retryable === false || error?.name === "AbortError") return false;
            return getMessageHistoryRefetchInterval(
                query.state.data?.length,
                limit,
                error?.attemptedPages,
            );
        },
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

export function useUpdateMessageTriggerRuleBranchActivation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateMessageTriggerRuleBranchActivationDto }) =>
            messageTriggersApi.updateBranchActivation(id, dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
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
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
        },
    });
}

// Cancels a still-pending trigger job. On success the job drops out of the
// upcoming list and a canceled entry appears in history, so both queries need
// a refetch for the row to visibly move from one zone to the other.
export function useCancelMessageTriggerJob() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => messageTriggersApi.cancelJob(id).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
        },
    });
}
