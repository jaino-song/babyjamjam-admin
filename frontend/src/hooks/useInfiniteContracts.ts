"use client";

import { useCallback, useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { getStatusCategory, DocumentFilterType } from "@/lib/eformsign/status-codes";

const INITIAL_VISIBLE_COUNT = 6; // First load: teaser view (4 full + 2 fading)
const PAGE_SIZE = 6; // How many more to show each time
const EMPTY_DOCUMENTS: EformsignDocument[] = [];
const EMPTY_EXCLUDED_NAMES: readonly string[] = [];

// Filter documents by actual status code
function filterByActualStatus(
  docs: EformsignDocument[],
  type: DocumentFilterType
): EformsignDocument[] {
  if (type === null) return docs;
  return docs.filter(
    (doc) => getStatusCategory(doc.current_status?.status_type) === type
  );
}

// Sort documents by created_date descending (newest first)
function sortByCreatedDate(docs: EformsignDocument[]): EformsignDocument[] {
  return [...docs].sort((a, b) => b.created_date - a.created_date);
}

// Helper to extract customer name from document
function getCustomerName(doc: EformsignDocument): string | null {
  const recipients = doc.current_status?.step_recipients;
  if (recipients && recipients.length > 0 && recipients[0]?.name) {
    return recipients[0].name;
  }
  if (doc.last_editor?.name) return doc.last_editor.name;
  if (doc.creator?.name) return doc.creator.name;
  return null;
}

export const infiniteContractsQueryKeys = {
  documents: (status: DocumentFilterType) =>
    status === null
      ? eformsignQueryKeys.allDocuments()
      : eformsignQueryKeys.documentsByType(status),
};

interface UseInfiniteContractsOptions {
  enabled?: boolean;
  filterType?: DocumentFilterType;
  /** Names to exclude from the results */
  excludedNames?: readonly string[];
}

/**
 * Client-side paginated hook for contracts.
 * Fetches all documents once, then reveals them progressively via "load more".
 */
export function useInfiniteContracts({
  enabled = true,
  filterType = null,
  excludedNames = EMPTY_EXCLUDED_NAMES,
}: UseInfiniteContractsOptions = {}) {
  // Track how many items are visible (starts at 6, increases by 20 each load)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  // Reset visible count when filter changes
  useEffect(() => {
    queueMicrotask(() => {
      setVisibleCount(INITIAL_VISIBLE_COUNT);
    });
  }, [filterType]);

  // Fetch all documents once
  const query = useQuery<EformsignDocumentsResponse>({
    queryKey: infiniteContractsQueryKeys.documents(filterType),
    queryFn: async () => {
      const response = await eformsignApi.getAllDocuments({
        limit: 100,
        skip: 0,
        type: filterType,
      });
      return response;
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    refetchOnWindowFocus: false,
  });

  // Process and filter all documents
  const queryDocuments = query.data?.documents;

  const excludedNameSet = useMemo(() => new Set(excludedNames), [excludedNames]);

  const allFilteredDocuments = useMemo(() => {
    if (!queryDocuments) return EMPTY_DOCUMENTS;

    // Filter by status type
    let docs = filterByActualStatus(queryDocuments, filterType);

    // Filter out excluded names
    if (excludedNameSet.size > 0) {
      docs = docs.filter((doc) => {
        const name = getCustomerName(doc);
        return name && !excludedNameSet.has(name);
      });
    }

    // Sort by created_date
    return sortByCreatedDate(docs);
  }, [excludedNameSet, filterType, queryDocuments]);

  // Slice to visible count
  const documents = useMemo(() => {
    return allFilteredDocuments.slice(0, visibleCount);
  }, [allFilteredDocuments, visibleCount]);

  // Check if there are more items to show
  const totalFilteredCount = allFilteredDocuments.length;
  const hasNextPage = visibleCount < totalFilteredCount;

  const fetchNextPage = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, totalFilteredCount));
  }, [setVisibleCount, totalFilteredCount]);

  return {
    documents,
    allDocuments: allFilteredDocuments,
    isLoading: query.isLoading,
    isFetchingNextPage: false,
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredDocuments.length,
    error: query.error,
    refetch: query.refetch,
  };
}
