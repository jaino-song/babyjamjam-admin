"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { isBranchContextAligned, useActiveBranchId } from "@/features/system-templates/branch-context";

import { clientsApi } from "../api/clients.api";
import { clientKeys } from "./keys";

type CapabilityStatus = "enabled" | "paused" | "loading" | "unavailable";

export function useBabyRecordCapability(open: boolean) {
    const branchId = useActiveBranchId();
    const aligned = isBranchContextAligned(branchId);
    const queryClient = useQueryClient();
    const queryKey = clientKeys.babyRecordCapability(branchId);
    const query = useQuery({
        queryKey,
        enabled: open && aligned,
        staleTime: 0,
        refetchOnMount: "always",
        retry: false,
        queryFn: async ({ signal }) => {
            if (!isBranchContextAligned(branchId)) throw new Error("Active branch changed");
            const enabled = await clientsApi.getBabyRecordCapability(signal);
            if (!isBranchContextAligned(branchId)) throw new Error("Active branch changed");
            return enabled;
        },
    });
    let status: CapabilityStatus = "unavailable";
    if (aligned && query.isFetching) {
        status = "loading";
    } else if (aligned && query.isSuccess && !query.isPaused && !query.isPlaceholderData && typeof query.data === "boolean") {
        status = query.data ? "enabled" : "paused";
    }

    // A submit can resume after an asynchronous validation or confirmation.
    const isEnabledNow = () => {
        const current = queryClient.getQueryState<boolean>(queryKey);
        return open && isBranchContextAligned(branchId) && current?.status === "success"
            && current.fetchStatus === "idle" && !current.isInvalidated && current.data === true;
    };

    return { branchId, status, isEnabledNow, retry: query.refetch };
}
