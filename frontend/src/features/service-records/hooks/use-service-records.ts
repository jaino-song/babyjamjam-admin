"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { serviceRecordsApi } from "../api/service-records.api";
import type {
    RetryServiceRecordDocumentInput,
    ServiceRecordRevisionHistoryResponse,
    ServiceRecordOverview,
} from "../types";
import { serviceRecordKeys } from "./keys";

export function useClientServiceRecords(
    clientId: number | null,
    options?: { enabled?: boolean },
) {
    return useQuery<ServiceRecordOverview>({
        queryKey: serviceRecordKeys.clientOverview(clientId),
        queryFn: () => {
            if (clientId === null) {
                throw new Error("clientId is required");
            }
            return serviceRecordsApi.getClientOverview(clientId).then((response) => response.data);
        },
        enabled: clientId !== null && (options?.enabled ?? true),
    });
}

export function useClientServiceRecordRevisionHistory(
    clientId: number | null,
    options?: { enabled?: boolean },
) {
    return useQuery<ServiceRecordRevisionHistoryResponse>({
        queryKey: serviceRecordKeys.revisionHistory(clientId),
        queryFn: () => {
            if (clientId === null) {
                throw new Error("clientId is required");
            }
            return serviceRecordsApi.getClientRevisionHistory(clientId).then((response) => response.data);
        },
        enabled: clientId !== null && (options?.enabled ?? true),
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });
}

export function useRetryServiceRecordDocument() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: RetryServiceRecordDocumentInput) =>
            serviceRecordsApi.retryRevisionDocument(input).then((response) => response.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.revisionHistories() });
            await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.all });
        },
    });
}

export function useSendServiceRecordLink() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ scheduleId, preparedLinkToken }: { scheduleId: number; clientId?: number; preparedLinkToken?: string }) =>
            serviceRecordsApi.sendLink(scheduleId, preparedLinkToken ? { preparedLinkToken } : {})
                .then((response) => response.data),
        onSuccess: async (_, variables) => {
            if (variables.clientId !== undefined) {
                await queryClient.invalidateQueries({
                    queryKey: serviceRecordKeys.clientOverview(variables.clientId),
                });
                return;
            }

            await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.all });
        },
    });
}
