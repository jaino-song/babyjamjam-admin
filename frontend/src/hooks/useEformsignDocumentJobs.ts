"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    eformsignApi,
    type CreateEformsignDocumentJobRequest,
    type EformsignDocumentJobList,
    type EformsignDocumentJobSummary,
    type EnqueueEformsignDocumentJobResponse,
    type FinalizeEformsignDocumentJobRequest,
} from "@/services/api";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { isBranchContextAligned, useActiveBranchId } from "@/features/system-templates/branch-context";

export type {
    CreateEformsignDocumentJobRequest,
    EformsignDocumentJobList,
    EformsignDocumentJobResponse,
    EformsignDocumentJobStatus,
    EformsignDocumentJobSummary,
    EnqueueEformsignDocumentJobResponse,
    FinalizeEformsignDocumentJobRequest,
} from "@/services/api";

const JOB_SUMMARY_REFETCH_INTERVAL_MS = 10_000;
const JOB_LIST_REFETCH_INTERVAL_MS = 3_000;

export const eformsignDocumentJobsQueryKeys = {
    all: ["eformsign-document-jobs"] as const,
    summary: (branchId: string | null) => [
        ...eformsignDocumentJobsQueryKeys.all,
        "summary",
        branchId ?? "unavailable",
    ] as const,
    list: (branchId: string | null) => [
        ...eformsignDocumentJobsQueryKeys.all,
        "list",
        branchId ?? "unavailable",
    ] as const,
};

// Singular alias keeps the factory discoverable alongside other eformsign keys.
export const eformsignDocumentJobQueryKeys = eformsignDocumentJobsQueryKeys;

export function useEformsignDocumentJobsSummary(isAuthenticated = true) {
    const activeBranchId = useActiveBranchId();
    const branchContextReady = isBranchContextAligned(activeBranchId);
    const summaryContextReady = isAuthenticated && branchContextReady;
    const query = useQuery<EformsignDocumentJobSummary>({
        queryKey: eformsignDocumentJobsQueryKeys.summary(activeBranchId),
        queryFn: () => {
            if (!activeBranchId || !isBranchContextAligned(activeBranchId)) {
                throw new Error("Branch selection required");
            }
            return eformsignApi.getDocumentJobSummary();
        },
        enabled: summaryContextReady,
        refetchInterval: JOB_SUMMARY_REFETCH_INTERVAL_MS,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: false,
    });

    // A branch switch changes the query key, but hide any cached result until
    // the new cookie identity is aligned so an old tenant's count cannot flash.
    return summaryContextReady ? query : { ...query, data: undefined };
}

export interface UseEformsignDocumentJobsOptions {
    isAuthenticated?: boolean;
    isPopoverOpen?: boolean;
}

export function useEformsignDocumentJobs({
    isAuthenticated = true,
    isPopoverOpen = false,
}: UseEformsignDocumentJobsOptions = {}) {
    const activeBranchId = useActiveBranchId();
    const branchContextReady = isBranchContextAligned(activeBranchId);
    const listContextReady = isAuthenticated && branchContextReady;
    const summaryQuery = useEformsignDocumentJobsSummary(isAuthenticated);
    const hasActiveJobs = (summaryQuery.data?.activeCount ?? 0) > 0;
    const shouldFetchList = listContextReady && (isPopoverOpen || hasActiveJobs);

    const listQuery = useQuery<EformsignDocumentJobList>({
        queryKey: eformsignDocumentJobsQueryKeys.list(activeBranchId),
        queryFn: () => {
            if (!activeBranchId || !isBranchContextAligned(activeBranchId)) {
                throw new Error("Branch selection required");
            }
            return eformsignApi.getDocumentJobs();
        },
        enabled: shouldFetchList,
        refetchInterval: shouldFetchList ? JOB_LIST_REFETCH_INTERVAL_MS : false,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: false,
    });

    return {
        ...listQuery,
        data: listContextReady ? listQuery.data : undefined,
        summary: summaryQuery.data,
        summaryQuery,
    };
}

async function invalidateDocumentJobQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    documentId?: string,
    clientId?: number,
): Promise<void> {
    const invalidations = [
        queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() }),
    ];

    if (documentId) {
        invalidations.push(
            queryClient.invalidateQueries({
                queryKey: ["eformsign-documents", "detail", documentId],
            }),
        );
    }

    if (clientId !== undefined) {
        invalidations.push(
            queryClient.invalidateQueries({
                queryKey: ["eformsign-docs", "client", clientId],
            }),
        );
    }

    await Promise.all(invalidations);
}

export function useEnqueueEformsignDocumentCreation() {
    const queryClient = useQueryClient();

    return useMutation<
        EnqueueEformsignDocumentJobResponse,
        Error,
        CreateEformsignDocumentJobRequest
    >({
        mutationFn: (params) => eformsignApi.enqueueDocumentCreation(params),
        onSuccess: async (_response, params) => {
            await invalidateDocumentJobQueries(queryClient, undefined, params.clientId);
        },
    });
}

export function useEnqueueEformsignDocumentFinalization() {
    const queryClient = useQueryClient();

    return useMutation<
        EnqueueEformsignDocumentJobResponse,
        Error,
        FinalizeEformsignDocumentJobRequest
    >({
        mutationFn: (params) => eformsignApi.enqueueDocumentFinalization(params),
        onSuccess: async (_response, params) => {
            await invalidateDocumentJobQueries(queryClient, params.documentId);
        },
    });
}
