import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { clientQueryKeys } from "@/hooks/useClients";
import type {
    CallCategory,
    CallRecordDetail,
    CallRecordListItem,
    ClientDraftDetail,
    ClientDraftListItem,
    ConfirmDraftBody,
    ConfirmUpdateBody,
    Paginated,
    Proposal,
} from "@/lib/call-inbox/types";

export const callInboxKeys = {
    all: ["call-inbox"] as const,
    records: (page: number, category?: string, search?: string) =>
        [...callInboxKeys.all, "records", page, category ?? "", search ?? ""] as const,
    record: (id: string) => [...callInboxKeys.all, "record", id] as const,
    drafts: (status: string, page: number) => [...callInboxKeys.all, "drafts", status, page] as const,
    draft: (id: string) => [...callInboxKeys.all, "draft", id] as const,
    count: () => [...callInboxKeys.all, "count"] as const,
};

export function useCallRecords(page: number, category?: CallCategory, search?: string) {
    return useQuery<Paginated<CallRecordListItem>>({
        queryKey: callInboxKeys.records(page, category, search),
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: "20" });
            if (category) params.set("category", category);
            if (search) params.set("search", search);
            const { data } = await api.get(`/call-records?${params.toString()}`);
            return data;
        },
        staleTime: 1000 * 30,
    });
}

export function useCallRecord(id: string | null) {
    return useQuery<CallRecordDetail>({
        queryKey: callInboxKeys.record(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/call-records/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function useClientDrafts(status: string = "PENDING", page: number = 1) {
    return useQuery<Paginated<ClientDraftListItem>>({
        queryKey: callInboxKeys.drafts(status, page),
        queryFn: async () => {
            const { data } = await api.get(`/client-drafts?status=${status}&page=${page}&limit=20`);
            return data;
        },
        staleTime: 1000 * 30,
    });
}

export function usePendingDraftCount() {
    return useQuery<{ count: number }>({
        queryKey: callInboxKeys.count(),
        queryFn: async () => {
            const { data } = await api.get("/client-drafts/count?status=PENDING");
            return data;
        },
        staleTime: 1000 * 60,
        refetchInterval: 1000 * 60,
    });
}

export function useClientDraft(id: string | null) {
    return useQuery<ClientDraftDetail>({
        queryKey: callInboxKeys.draft(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/client-drafts/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function usePatchDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { proposals?: Proposal[]; clientId?: number | null }) => {
            const { data } = await api.patch(`/client-drafts/${id}`, body);
            return data as ClientDraftDetail;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}

export function useConfirmDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: ConfirmDraftBody | ConfirmUpdateBody) => {
            const { data } = await api.post(`/client-drafts/${id}/confirm`, body);
            return data as { clientId: number };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: callInboxKeys.all });
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

export function useDiscardDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { reason?: string }) => {
            const { data } = await api.post(`/client-drafts/${id}/discard`, body);
            return data as { id: string; status: "DISCARDED" };
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}
