"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { serviceRecordsApi } from "../api/service-records.api";
import type {
    RetryServiceRecordDocumentInput,
    ServiceRecordCaregiverEditChangesResponse,
    ServiceRecordRevisionChangesResponse,
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

/** One revision's before -> after changes. Disabled until a revision is selected. */
export function useClientServiceRecordRevisionChanges(
    clientId: number | null,
    revisionId: string | null,
    options?: { enabled?: boolean },
) {
    return useQuery<ServiceRecordRevisionChangesResponse>({
        queryKey: serviceRecordKeys.revisionChanges(clientId, revisionId),
        queryFn: () => {
            if (clientId === null || revisionId === null) {
                throw new Error("clientId and revisionId are required");
            }
            return serviceRecordsApi.getClientRevisionChanges(clientId, revisionId).then((response) => response.data);
        },
        enabled: clientId !== null && revisionId !== null && (options?.enabled ?? true),
    });
}

/** One caregiver edit's before -> after changes. Disabled until an edit is selected. */
export function useClientServiceRecordCaregiverEditChanges(
    clientId: number | null,
    editId: string | null,
    options?: { enabled?: boolean },
) {
    return useQuery<ServiceRecordCaregiverEditChangesResponse>({
        queryKey: serviceRecordKeys.caregiverEditChanges(clientId, editId),
        queryFn: () => {
            if (clientId === null || editId === null) {
                throw new Error("clientId and editId are required");
            }
            return serviceRecordsApi.getClientCaregiverEditChanges(clientId, editId).then((response) => response.data);
        },
        enabled: clientId !== null && editId !== null && (options?.enabled ?? true),
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
