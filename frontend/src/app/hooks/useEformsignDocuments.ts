"use client";

import { useQuery } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocumentsResponse, EformsignDocument } from "@/app/lib/eformsign/types";
import {
  DocumentFilterType,
  getLegacyDocumentStatusCategory,
  hydrateLegacyDocumentCustomerName,
  LEGACY_EXCLUDED_CUSTOMER_NAMES,
  needsLegacyDocumentDetail,
} from "@/app/lib/eformsign/status-codes";

// Re-export types for convenience
export type { DocumentFilterType } from "@/app/lib/eformsign/status-codes";

// Debug logging (only in development)
const isDev = process.env.NODE_ENV === "development";
const debugLog = isDev ? console.log.bind(console) : () => {};

// Filter documents by actual status code (not just inbox type)
function filterByActualStatus(docs: EformsignDocument[], type: DocumentFilterType): EformsignDocument[] {
  if (type === null) return docs;
  return docs.filter(doc => getLegacyDocumentStatusCategory(doc.current_status) === type);
}

// Query keys
export const eformsignQueryKeys = {
  documents: () => ["eformsign-documents"] as const,
  documentsByType: (type: string) => ["eformsign-documents", type] as const,
  allDocuments: () => ["eformsign-documents", "all"] as const,
};

// Fetch all documents using unified backend endpoint (single request instead of 3)
async function fetchAllDocuments(): Promise<EformsignDocumentsResponse> {
  // Uses the unified /documents endpoint which fetches all types on the backend
  const [response, clientSummaries] = await Promise.all([
    eformsignApi.getAllDocuments(),
    eformsignApi.getDocumentClientNames().catch((error) => {
      debugLog("[fetchAllDocuments] Failed to fetch stored client names", error);
      return [];
    }),
  ]);
  const clientNameByDocumentId = new Map(
    clientSummaries.map((summary) => [summary.documentId, summary.clientName]),
  );
  const documents = (response.documents || []).map((doc) =>
    hydrateLegacyDocumentCustomerName(doc, clientNameByDocumentId.get(doc.id)),
  );
  const unresolvedContracts = documents.filter((doc) =>
    needsLegacyDocumentDetail(doc, LEGACY_EXCLUDED_CUSTOMER_NAMES)
  );

  if (unresolvedContracts.length > 0) {
    const detailEntries = await Promise.all(
      unresolvedContracts.map(async (doc) => {
        try {
          const detail = await eformsignApi.getDocument(doc.id);
          return [doc.id, detail] as const;
        } catch (error) {
          debugLog(`[fetchAllDocuments] Failed to hydrate ${doc.id}`, error);
          return [doc.id, null] as const;
        }
      })
    );
    const detailsById = new Map(detailEntries);

    response.documents = documents.map((doc) => {
      const detail = detailsById.get(doc.id);
      return detail ? { ...doc, recipients: detail.recipients } : doc;
    });
  } else {
    response.documents = documents;
  }

  debugLog(`[fetchAllDocuments] Received ${response.documents?.length || 0} docs`);
  return response;
}

// Hook to fetch documents by type (in-progress, completed, rejected, or all)
export function useEformsignDocumentsByType(isAuthenticated: boolean, type: DocumentFilterType) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: type === null 
      ? eformsignQueryKeys.allDocuments() 
      : eformsignQueryKeys.documentsByType(type),
    queryFn: async () => {
      let response: EformsignDocumentsResponse;
      
      switch (type) {
        case null:
          response = await fetchAllDocuments();
          break;
        case "in-progress":
          response = await eformsignApi.getInProgressDocuments();
          break;
        case "completed":
          response = await fetchAllDocuments();
          break;
        case "rejected":
          response = await eformsignApi.getRejectedDocuments();
          break;
        default:
          throw new Error("Invalid type");
      }
      
      // Filter by actual status code
      const filteredDocs = filterByActualStatus(response.documents || [], type);
      
      // Sort by created_date descending (newest first)
      filteredDocs.sort((a, b) => b.created_date - a.created_date);
      
      debugLog(`[useEformsignDocuments] Type: ${type}, Filtered: ${response.documents?.length || 0} -> ${filteredDocs.length}`);
      
      return {
        ...response,
        documents: filteredDocs,
        total_rows: filteredDocs.length,
      };
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60,   // 1 hour (garbage collection)
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
