"use client";

import { useQuery } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocumentsResponse } from "@/app/lib/eformsign/types";
import {
  DocumentFilterType,
  filterDocumentsByStatus,
  LEGACY_EXCLUDED_CUSTOMER_NAMES,
  needsLegacyDocumentDetail,
} from "@/app/lib/eformsign/status-codes";

// Re-export types for convenience
export type { DocumentFilterType } from "@/app/lib/eformsign/status-codes";

// Debug logging (only in development)
const isDev = process.env.NODE_ENV === "development";
const debugLog = isDev ? console.log.bind(console) : () => {};

// Query keys
export const eformsignQueryKeys = {
  documents: () => ["eformsign-documents"] as const,
  documentsByType: (type: string) => ["eformsign-documents", type] as const,
  allDocuments: () => ["eformsign-documents", "all"] as const,
};

// Fetch all documents using unified backend endpoint (single request instead of 3)
async function fetchAllDocuments(): Promise<EformsignDocumentsResponse> {
  // Uses the unified /documents endpoint which fetches all types on the backend
  const response = await eformsignApi.getAllDocuments();
  const documents = response.documents || [];
  const unresolvedContracts = documents.filter((doc) =>
    needsLegacyDocumentDetail(doc, LEGACY_EXCLUDED_CUSTOMER_NAMES)
  );

  if (unresolvedContracts.length > 0) {
    const detailEntries = await Promise.all(
      unresolvedContracts.map(async (doc) => {
        try {
          const detail = await eformsignApi.getDocument(doc.id);
          return [doc.id, detail] as const;
        } catch {
          debugLog(`[fetchAllDocuments] Failed to hydrate ${doc.id}`);
          return [doc.id, null] as const;
        }
      })
    );
    const detailsById = new Map(detailEntries);

    response.documents = documents.map((doc) => {
      const detail = detailsById.get(doc.id);
      return detail
        ? { ...doc, fields: detail.fields, recipients: detail.recipients }
        : doc;
    });
  }

  debugLog(`[fetchAllDocuments] Received ${response.documents?.length || 0} docs`);
  return response;
}

// Every category selects from the same merged inbox cache.
export function useEformsignDocumentsByType(isAuthenticated: boolean, type: DocumentFilterType) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: eformsignQueryKeys.allDocuments(),
    queryFn: fetchAllDocuments,
    select: (response) => {
      const documents = filterDocumentsByStatus(response.documents || [], type)
        .sort((a, b) => b.created_date - a.created_date);
      return { ...response, documents, total_rows: documents.length };
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });
}

// Legacy hook for backward compatibility
export function useEformsignDocuments(isAuthenticated: boolean = true) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: eformsignQueryKeys.documents(),
    queryFn: async () => eformsignApi.getDocuments(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });
}
