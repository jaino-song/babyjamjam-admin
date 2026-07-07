"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type {
    SendServiceRecordLinkResponse,
    ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

export const serviceRecordQueryKeys = {
    all: ["service-records"] as const,
    clientOverviews: () => [...serviceRecordQueryKeys.all, "client-overview"] as const,
    clientOverview: (clientId: number | null) =>
        [...serviceRecordQueryKeys.clientOverviews(), clientId ?? "none"] as const,
};

function isValidClientId(clientId: number | null): clientId is number {
    return Number.isInteger(clientId) && clientId !== null && clientId > 0;
}

export async function fetchClientServiceRecords(clientId: number): Promise<ServiceRecordOverview> {
    const { data } = await api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`);
    return data;
}

export function useClientServiceRecords(
    clientId: number | null,
    options: { enabled?: boolean } = {},
) {
    return useQuery<ServiceRecordOverview>({
        queryKey: serviceRecordQueryKeys.clientOverview(clientId),
        queryFn: () => {
            if (!isValidClientId(clientId)) {
                throw new Error("clientId is required");
            }
            return fetchClientServiceRecords(clientId);
        },
        enabled: isValidClientId(clientId) && (options.enabled ?? true),
    });
}

export function useSendServiceRecordLink() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ scheduleId }: { scheduleId: number; clientId?: number }) => {
            const { data } = await api.post<SendServiceRecordLinkResponse>(
                `/admin/service-records/schedules/${scheduleId}/send-link`,
                {},
            );
            return data;
        },
        onSuccess: (_, variables) => {
            if (Number.isInteger(variables.clientId) && variables.clientId !== undefined && variables.clientId > 0) {
                queryClient.invalidateQueries({
                    queryKey: serviceRecordQueryKeys.clientOverview(variables.clientId),
                });
                return;
            }

            queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.all });
        },
    });
}
