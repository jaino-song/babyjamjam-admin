"use client";

import { preparedServiceRecordMembers } from "@babyjamjam/shared/utils";
import type { ResetServiceRecordLinkRequest } from "@babyjamjam/shared/types/service-record";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clientKeys } from "@/features/clients/hooks/keys";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";

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
    options?: { enabled?: boolean; caseId?: string; refreshOnFocus?: boolean },
) {
    return useQuery<ServiceRecordOverview>({
        queryKey: serviceRecordKeys.clientOverview(clientId, options?.caseId),
        queryFn: () => {
            if (clientId === null) {
                throw new Error("clientId is required");
            }
            return serviceRecordsApi.getClientOverview(clientId, ...(options?.caseId ? [options.caseId] : [])).then((response) => response.data);
        },
        enabled: clientId !== null && (options?.enabled ?? true),
        ...(options?.refreshOnFocus ? {
            staleTime: 0,
            refetchOnWindowFocus: "always",
            refetchOnReconnect: "always",
        } as const : {}),
    });
}

export function useClientServiceRecordRevisionHistory(
    clientId: number | null,
    options?: { enabled?: boolean; caseId?: string },
) {
    return useQuery<ServiceRecordRevisionHistoryResponse>({
        queryKey: serviceRecordKeys.revisionHistory(clientId, options?.caseId),
        queryFn: () => {
            if (clientId === null) {
                throw new Error("clientId is required");
            }
            return serviceRecordsApi.getClientRevisionHistory(clientId, ...(options?.caseId ? [options.caseId] : [])).then((response) => response.data);
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
    options?: { enabled?: boolean; caseId?: string },
) {
    return useQuery<ServiceRecordRevisionChangesResponse>({
        queryKey: serviceRecordKeys.revisionChanges(clientId, revisionId, options?.caseId),
        queryFn: () => {
            if (clientId === null || revisionId === null) {
                throw new Error("clientId and revisionId are required");
            }
            return serviceRecordsApi.getClientRevisionChanges(clientId, revisionId, ...(options?.caseId ? [options.caseId] : [])).then((response) => response.data);
        },
        enabled: clientId !== null && revisionId !== null && (options?.enabled ?? true),
    });
}

/** One caregiver edit's before -> after changes. Disabled until an edit is selected. */
export function useClientServiceRecordCaregiverEditChanges(
    clientId: number | null,
    editId: string | null,
    options?: { enabled?: boolean; caseId?: string },
) {
    return useQuery<ServiceRecordCaregiverEditChangesResponse>({
        queryKey: serviceRecordKeys.caregiverEditChanges(clientId, editId, options?.caseId),
        queryFn: () => {
            if (clientId === null || editId === null) {
                throw new Error("clientId and editId are required");
            }
            return serviceRecordsApi.getClientCaregiverEditChanges(clientId, editId, ...(options?.caseId ? [options.caseId] : [])).then((response) => response.data);
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
        mutationFn: async ({ scheduleId, preparedLinkToken, caseId, target }: {
            scheduleId: number;
            clientId?: number;
            preparedLinkToken?: string;
            caseId?: string;
            target?: Extract<ResetServiceRecordLinkRequest, { members: unknown }>;
        }) => {
            if (target) {
                const { data } = await serviceRecordsApi.prepareLink(scheduleId, {
                    employeeId: target.employeeId, caseIds: target.members.map((member) => member.caseId),
                });
                const members = preparedServiceRecordMembers(data, target.employeeId, target.members);
                if (!members) throw new Error("제공기록지 배정이 변경되었어요.");
                return serviceRecordsApi.sendLink(scheduleId, { employeeId: target.employeeId, members }).then(({ data }) => data);
            }
            return serviceRecordsApi.sendLink(scheduleId, { ...(preparedLinkToken ? { preparedLinkToken } : {}), ...(caseId ? { caseId } : {}) }).then(({ data }) => data);
        },
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

export function useKeepPeriodMismatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ clientId, sessionIndexes, caseId }: { clientId: number; sessionIndexes: number[]; caseId?: string }) =>
            serviceRecordsApi.keepPeriodMismatch(clientId, sessionIndexes, ...(caseId ? [caseId] : [])).then((response) => response.data),
        onSuccess: async (_, { clientId }) => {
            await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(clientId) });
        },
    });
}

export function useFitPeriodMismatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ clientId, caseId }: { clientId: number; caseId?: string }) =>
            serviceRecordsApi.fitPeriodMismatch(clientId, ...(caseId ? [caseId] : [])).then((response) => response.data),
        onSuccess: async (_, { clientId }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(clientId) }),
                queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) }),
                queryClient.invalidateQueries({ queryKey: clientKeys.all }),
                queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.overviewAll() }),
            ]);
        },
    });
}
