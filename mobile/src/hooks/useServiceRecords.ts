"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clientQueryKeys } from "@/hooks/useClients";
import { api } from "@/lib/api/client";
import type {
    ResetServiceRecordLinkResponse,
    SendServiceRecordLinkResponse,
    ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

export const serviceRecordQueryKeys = {
    all: ["service-records"] as const,
    clientOverviews: () => [...serviceRecordQueryKeys.all, "client-overview"] as const,
    clientOverview: (clientId: number | null, caseId?: string) =>
        [...serviceRecordQueryKeys.clientOverviews(), clientId ?? "none", ...(caseId ? [caseId] : [])] as const,
};

function isValidClientId(clientId: number | null): clientId is number {
    return Number.isInteger(clientId) && clientId !== null && clientId > 0;
}

function withCaseId(path: string, caseId?: string): string {
    return caseId === undefined ? path : `${path}?caseId=${encodeURIComponent(caseId)}`;
}

export async function fetchClientServiceRecords(clientId: number, caseId?: string): Promise<ServiceRecordOverview> {
    const { data } = await api.get<ServiceRecordOverview>(withCaseId(`/admin/service-records/client/${clientId}`, caseId));
    return data;
}

export async function resetServiceRecordLink(scheduleId: number): Promise<ResetServiceRecordLinkResponse> {
    const { data } = await api.post<ResetServiceRecordLinkResponse>(
        `/admin/service-records/schedules/${scheduleId}/reset-link`,
        {},
    );
    return data;
}

export function useClientServiceRecords(
    clientId: number | null,
    options: { enabled?: boolean; caseId?: string } = {},
) {
    return useQuery<ServiceRecordOverview>({
        queryKey: serviceRecordQueryKeys.clientOverview(clientId, options.caseId),
        queryFn: () => {
            if (!isValidClientId(clientId)) {
                throw new Error("clientId is required");
            }
            return fetchClientServiceRecords(clientId, options.caseId);
        },
        enabled: isValidClientId(clientId) && (options.enabled ?? true),
    });
}

export function useSendServiceRecordLink() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ scheduleId, preparedLinkToken, caseId }: { scheduleId: number; clientId?: number; preparedLinkToken?: string; caseId?: string }) => {
            const { data } = await api.post<SendServiceRecordLinkResponse>(
                `/admin/service-records/schedules/${scheduleId}/send-link`,
                { ...(preparedLinkToken ? { preparedLinkToken } : {}), ...(caseId ? { caseId } : {}) },
            );
            return data;
        },
        onSuccess: async (_, variables) => {
            if (Number.isInteger(variables.clientId) && variables.clientId !== undefined && variables.clientId > 0) {
                await queryClient.invalidateQueries({
                    queryKey: serviceRecordQueryKeys.clientOverview(variables.clientId),
                });
                return;
            }

            await queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.all });
        },
    });
}

export function useKeepPeriodMismatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ clientId, sessionIndexes, caseId }: { clientId: number; sessionIndexes: number[]; caseId?: string }) => {
            const { data } = await api.post<{ keptSessionIndexes: number[] }>(
                withCaseId(`/admin/service-records/client/${clientId}/period-mismatch/keep`, caseId),
                { sessionIndexes },
            );
            return data;
        },
        onSuccess: async (_, { clientId }) => {
            await queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.clientOverview(clientId) });
        },
    });
}

export function useFitPeriodMismatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ clientId, caseId }: { clientId: number; caseId?: string }) => {
            const { data } = await api.post<{ startDate: string | null; endDate: string | null }>(
                withCaseId(`/admin/service-records/client/${clientId}/period-mismatch/fit`, caseId),
                {},
            );
            return data;
        },
        onSuccess: async (_, { clientId }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.clientOverview(clientId) }),
                queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(clientId) }),
            ]);
        },
    });
}
