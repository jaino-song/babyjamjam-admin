"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { eformsignApi, withEformsignReauth } from "@/services/api";
import { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { getStatusCategory, isDeletedStatusCode, DocumentFilterType } from "@/lib/eformsign/status-codes";
import { UNKNOWN_CUSTOMER_NAME, customerName } from "@/lib/eformsign/display-name";

const INITIAL_VISIBLE_COUNT = 6; // First load: teaser view (4 full + 2 fading)
const PAGE_SIZE = 6; // How many more to show each time

// Filter documents by actual status code
function filterByActualStatus(
  docs: EformsignDocument[],
  type: DocumentFilterType
): EformsignDocument[] {
  const visibleDocs = docs.filter((doc) => !isDeletedStatusCode(doc.current_status?.status_type));
  if (type === null) return visibleDocs;
  const category = type === "rejected" ? "expired" : type;
  return visibleDocs.filter(
    (doc) => getStatusCategory(doc.current_status?.status_type) === category
  );
}

// Sort documents by created_date descending (newest first)
function sortByCreatedDate(docs: EformsignDocument[]): EformsignDocument[] {
  return [...docs].sort((a, b) => b.created_date - a.created_date);
}

export const infiniteContractsQueryKeys = {
  documents: (status: DocumentFilterType) =>
    ["eformsign-documents", "client-paginated", status ?? "all"] as const,
};

interface UseInfiniteContractsOptions {
  enabled?: boolean;
  filterType?: DocumentFilterType;
  /** Names to exclude from the results */
  excludedNames?: string[];
}

/**
 * Client-side paginated hook for contracts.
 * Fetches all documents once, then reveals them progressively via "load more".
 */
export function useInfiniteContracts({
  enabled = true,
  filterType = null,
  excludedNames = [],
}: UseInfiniteContractsOptions = {}) {
  const visibilityKey = `${filterType ?? "all"}:${excludedNames.join("|")}`;
  const [visibleState, setVisibleState] = useState({
    key: visibilityKey,
    count: INITIAL_VISIBLE_COUNT,
  });
  const visibleCount =
    visibleState.key === visibilityKey ? visibleState.count : INITIAL_VISIBLE_COUNT;

  // Fetch all documents once
  const query = useQuery<EformsignDocumentsResponse>({
    queryKey: infiniteContractsQueryKeys.documents(filterType),
    queryFn: () => withEformsignReauth(() => eformsignApi.getAllDocuments()),
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  // Process and filter all documents
  const allFilteredDocuments = useMemo(() => {
    const sourceDocuments = query.data?.documents ?? [];

    // Filter by status type
    let docs = filterByActualStatus(sourceDocuments, filterType);

    // Filter out excluded names
    if (excludedNames.length > 0) {
      docs = docs.filter((doc) => {
        const name = customerName(doc);
        return name !== UNKNOWN_CUSTOMER_NAME && !excludedNames.includes(name);
      });
    }

    // Sort by created_date
    return sortByCreatedDate(docs);
  }, [query.data, filterType, excludedNames]);

  // Slice to visible count
  const documents = useMemo(() => {
    return allFilteredDocuments.slice(0, visibleCount);
  }, [allFilteredDocuments, visibleCount]);

  // Check if there are more items to show
  const hasNextPage = visibleCount < allFilteredDocuments.length;

  // Whether we're showing the initial teaser view
  const isInitialLoad = visibleCount <= INITIAL_VISIBLE_COUNT;

  // Load more function - just increases visible count
  const fetchNextPage = useCallback(() => {
    setVisibleState({
      key: visibilityKey,
      count: Math.min(visibleCount + PAGE_SIZE, allFilteredDocuments.length),
    });
  }, [allFilteredDocuments.length, visibilityKey, visibleCount]);

  return {
    documents,
    isLoading: query.isLoading,
    isFetchingNextPage: false, // Client-side pagination is instant
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredDocuments.length,
    /** True when showing the initial teaser view (first 6 items) */
    isInitialLoad,
    error: query.error,
    refetch: query.refetch,
  };
}
