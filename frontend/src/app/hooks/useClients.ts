"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";
import type { 
    Client, 
    CreateClientDto, 
    UpdateClientDto, 
    PaginatedResponse 
} from "@/app/lib/client/types";

// Query keys - using factory pattern for proper invalidation
export const clientQueryKeys = {
    all: ["clients"] as const,
    lists: () => [...clientQueryKeys.all, "list"] as const,
    list: (page?: number, limit?: number, search?: string) => 
        [...clientQueryKeys.lists(), { page, limit, search }] as const,
    details: () => [...clientQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...clientQueryKeys.details(), id] as const,
};

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
        queryFn: async () => {
            const { data } = await api.get(`/clients/${id}`);
            return data;
        },
        enabled: !!id,
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

// Delete client mutation
export function useDeleteClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/clients/${id}`);
        },
        onSuccess: () => {
            // Invalidate all client queries (lists + details) using prefix match
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

