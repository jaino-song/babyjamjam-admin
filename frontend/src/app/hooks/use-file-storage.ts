"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";
import { AxiosProgressEvent } from "axios";

// ============================================================================
// Query Keys
// ============================================================================

export const fileStorageQueryKeys = {
    all: ["file-storage"] as const,
    lists: () => [...fileStorageQueryKeys.all, "list"] as const,
    list: (filter?: DocumentFilter) => [...fileStorageQueryKeys.lists(), filter] as const,
    details: () => [...fileStorageQueryKeys.all, "detail"] as const,
    detail: (id: string) => [...fileStorageQueryKeys.details(), id] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * 문서 엔티티 (백엔드와 동일)
 */
export interface Document {
    id: string;
    name: string;
    description: string | null;
    category: string;
    tags: string[];
    mimeType: string;
    fileSize: number;
    storagePath: string;
    storageUrl?: string | null; // deprecated, may be null for new uploads
    orgId: string | null;
    uploadedBy: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * 문서 필터링 옵션
 */
export interface DocumentFilter {
    category?: string;
    tags?: string[];
    uploadedBy?: string;
    orgId?: string;
}

/**
 * 문서 업로드 파라미터
 */
export interface UploadDocumentParams {
    file: File;
    category: string;
    tags: string[];
    description?: string;
    onProgress?: (progress: number) => void;
}

/**
 * 문서 메타데이터 업데이트 파라미터
 */
export interface UpdateDocumentParams {
    name?: string;
    description?: string;
    category?: string;
    tags?: string[];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * 문서 목록 조회
 * @param filter - 필터링 옵션
 */
export function useDocuments(filter?: DocumentFilter) {
    return useQuery<Document[]>({
        queryKey: fileStorageQueryKeys.list(filter),
        queryFn: async () => {
            const { data } = await api.get("/file-storage", {
                params: filter,
            });
            return data;
        },
        staleTime: 1000 * 60 * 5, // 5분
    });
}

/**
 * 단일 문서 조회
 * @param id - 문서 ID
 */
export function useDocument(id: string) {
    return useQuery<Document>({
        queryKey: fileStorageQueryKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get(`/file-storage/${id}`);
            return data;
        },
        enabled: !!id,
    });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * 문서 업로드 뮤테이션
 * 파일 업로드 진행률 추적 지원
 */
export function useUploadDocument() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            file,
            category,
            tags,
            description,
            onProgress,
        }: UploadDocumentParams) => {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("category", category);
            formData.append("tags", JSON.stringify(tags));
            if (description) {
                formData.append("description", description);
            }

            const { data } = await api.post<Document>("/file-storage", formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
                timeout: 120000,
                onUploadProgress: (progressEvent: AxiosProgressEvent) => {
                    const progress = Math.round(
                        (progressEvent.loaded * 100) / (progressEvent.total || 1)
                    );
                    onProgress?.(progress);
                },
            });

            return data;
        },
        onSuccess: () => {
            // 모든 문서 관련 쿼리 무효화
            queryClient.invalidateQueries({
                queryKey: fileStorageQueryKeys.all,
            });
        },
    });
}

/**
 * 문서 메타데이터 업데이트 뮤테이션
 */
export function useUpdateDocument() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            id,
            params,
        }: {
            id: string;
            params: UpdateDocumentParams;
        }) => {
            const { data } = await api.patch<Document>(
                `/file-storage/${id}`,
                params
            );
            return data;
        },
        onSuccess: (_, variables) => {
            // 목록과 상세 쿼리 무효화
            queryClient.invalidateQueries({
                queryKey: fileStorageQueryKeys.all,
            });
            queryClient.invalidateQueries({
                queryKey: fileStorageQueryKeys.detail(variables.id),
            });
        },
    });
}

/**
 * 문서 삭제 뮤테이션
 */
export function useDeleteDocument() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/file-storage/${id}`);
        },
        onSuccess: () => {
            // 모든 문서 관련 쿼리 무효화
            queryClient.invalidateQueries({
                queryKey: fileStorageQueryKeys.all,
            });
        },
    });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * get the download url for a document
 * @param id - document id
 * @param attachment - if true, browser will download instead of preview
 */
export function getDownloadUrl(id: string, attachment?: boolean): string {
    const base = `/api/file-storage/${id}/download`;
    return attachment ? `${base}?attachment=true` : base;
}
