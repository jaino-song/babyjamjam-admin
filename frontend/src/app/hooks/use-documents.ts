"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";

// Document type matching backend entity
export interface Document {
    id: string;
    name: string;
    description?: string;
    category: string;
    tags: string[];
    mimeType: string;
    fileSize: number;
    storagePath: string;
    storageUrl?: string;
    orgId?: string;
    uploadedBy: string;
    createdAt: string;
    updatedAt: string;
}

// Upload document params
export interface UploadDocumentParams {
    file: File;
    name?: string;
    description?: string;
    category: string;
    tags?: string[];
    orgId?: string;
    uploadedBy?: string;
    onProgress?: (progress: number) => void;
}

// Update document params
export interface UpdateDocumentParams {
    name?: string;
    description?: string;
    category?: string;
    tags?: string[];
}

// Query key factory pattern
export const documentQueryKeys = {
    all: ["documents"] as const,
    lists: () => [...documentQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...documentQueryKeys.lists(), filters] as const,
    details: () => [...documentQueryKeys.all, "detail"] as const,
    detail: (id: string) => [...documentQueryKeys.details(), id] as const,
};

/**
 * Hook to fetch all documents with optional category filter
 */
export function useDocuments(category?: string) {
    return useQuery<Document[]>({
        queryKey: documentQueryKeys.list({ category }),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (category) params.append("category", category);
            const url = `/documents${params.toString() ? `?${params.toString()}` : ""}`;
            const { data } = await api.get<Document[]>(url);
            return data;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

/**
 * Hook to fetch a single document by id
 */
export function useDocument(id: string) {
    return useQuery<Document>({
        queryKey: documentQueryKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get<Document>(`/documents/${id}`);
            return data;
        },
        enabled: !!id,
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

/**
 * Hook to upload a document with progress tracking
 */
export function useUploadDocument() {
    const queryClient = useQueryClient();

    return useMutation<Document, Error, UploadDocumentParams>({
        mutationFn: async ({
            file,
            name,
            description,
            category,
            tags,
            orgId,
            uploadedBy,
            onProgress,
        }: UploadDocumentParams) => {
            const formData = new FormData();
            formData.append("file", file);
            if (name) formData.append("name", name);
            if (description) formData.append("description", description);
            formData.append("category", category);
            if (tags) formData.append("tags", JSON.stringify(tags));
            if (orgId) formData.append("orgId", orgId);
            if (uploadedBy) formData.append("uploadedBy", uploadedBy);

            const { data } = await api.post<Document>("/documents", formData, {
                onUploadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.total) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress(progress);
                    }
                },
            });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
        },
        onError: (error) => {
            console.error("[useUploadDocument] onError called:", error);
        },
    });
}

/**
 * Hook to update document metadata
 */
export function useUpdateDocument() {
    const queryClient = useQueryClient();

    return useMutation<Document, Error, { id: string } & UpdateDocumentParams>({
        mutationFn: async ({ id, ...params }: { id: string } & UpdateDocumentParams) => {
            const { data } = await api.put<Document>(`/documents/${id}`, params);
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
            queryClient.invalidateQueries({ queryKey: documentQueryKeys.detail(data.id) });
        },
        onError: (error) => {
            console.error("[useUpdateDocument] onError called:", error);
        },
    });
}

/**
 * Hook to delete a document
 */
export function useDeleteDocument() {
     const queryClient = useQueryClient();

     return useMutation<string, Error, string>({
         mutationFn: async (id: string) => {
             await api.delete(`/documents/${id}`);
             return id;
         },
         onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
         },
         onError: (error) => {
             console.error("[useDeleteDocument] onError called:", error);
         },
     });
}

/**
 * Get the download URL for a document (proxied through Next.js API)
 * @param id - document ID
 * @param attachment - if true, browser will download instead of preview
 */
export function getDownloadUrl(id: string, attachment?: boolean): string {
     const base = `/api/documents/${id}/download`;
     return attachment ? `${base}?attachment=true` : base;
}
