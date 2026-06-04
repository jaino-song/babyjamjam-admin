"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { 
    Client, 
    CreateClientDto, 
    UpdateClientDto, 
    PaginatedResponse 
} from "@/lib/client/types";

// Query keys - using factory pattern for proper invalidation
export const clientQueryKeys = {
    all: ["clients"] as const,
    lists: () => [...clientQueryKeys.all, "list"] as const,
    list: (page?: number, limit?: number, search?: string) => 
        [...clientQueryKeys.lists(), { page, limit, search }] as const,
    filtered: (filter: string) => [...clientQueryKeys.all, "filtered", filter] as const,
    details: () => [...clientQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...clientQueryKeys.details(), id] as const,
};

function isValidClientId(id: number): boolean {
    return Number.isInteger(id) && id > 0;
}

export async function fetchClient(id: number): Promise<Client> {
    const { data } = await api.get(`/clients/${id}`);
    return data;
}

// Fetch all clients (paginated)
export function useClients(page: number = 1, limit: number = 10, search?: string) {
    return useQuery<PaginatedResponse<Client>>({
        queryKey: clientQueryKeys.list(page, limit, search),
        queryFn: async () => {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("limit", String(limit));
            if (search) params.set("search", search);
            
            const { data } = await api.get(`/clients?${params.toString()}`);
            return data;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

// Fetch all clients (non-paginated, for dropdowns)
export function useAllClients() {
    return useQuery<Client[]>({
        queryKey: clientQueryKeys.all,
        queryFn: async () => {
            const { data } = await api.get("/clients");
            return data;
        },
        staleTime: 1000 * 60 * 5,
    });
}

// Fetch single client by ID
export function useClient(id: number) {
    return useQuery<Client>({
        queryKey: clientQueryKeys.detail(id),
        queryFn: () => fetchClient(id),
        enabled: isValidClientId(id),
    });
}

// Fetch filtered clients
export function useFilteredClients(filter: string) {
    return useQuery<Client[]>({
        queryKey: clientQueryKeys.filtered(filter),
        queryFn: async () => {
            const { data } = await api.get(`/clients?filter=${filter}`);
            return data;
        },
        enabled: !!filter,
        staleTime: 1000 * 60,
    });
}

// Create client mutation
export function useCreateClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (dto: CreateClientDto) => {
            const { data } = await api.post("/clients", dto);
            return data as Client;
        },
        onSuccess: () => {
            // Invalidate all client queries (lists + details) using prefix match
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

// Update client mutation
export function useUpdateClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, dto }: { id: number; dto: UpdateClientDto }) => {
            const { data } = await api.patch(`/clients/${id}`, dto);
            return data as Client;
        },
        onSuccess: (_, variables) => {
            // Invalidate all client queries (lists + details) using prefix match
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
            // Also explicitly invalidate the specific detail query
            queryClient.invalidateQueries({ 
                queryKey: clientQueryKeys.detail(variables.id) 
            });
        },
    });
}

export function useDeleteClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/clients/${id}`);
        },
        onMutate: async (id: number) => {
            await queryClient.cancelQueries({ queryKey: clientQueryKeys.all });

            const previousQueries = queryClient.getQueriesData<PaginatedResponse<Client>>({
                queryKey: clientQueryKeys.lists(),
            });

            queryClient.setQueriesData<PaginatedResponse<Client>>(
                { queryKey: clientQueryKeys.lists() },
                (old) => old ? {
                    ...old,
                    data: old.data.filter((c) => c.id !== id),
                    total: old.total - 1,
                } : old,
            );

            return { previousQueries };
        },
        onError: (_err, _id, context) => {
            context?.previousQueries?.forEach(([queryKey, data]) => {
                queryClient.setQueryData(queryKey, data);
            });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}
