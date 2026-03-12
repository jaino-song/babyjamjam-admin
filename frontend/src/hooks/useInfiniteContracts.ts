"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { getStatusCategory, DocumentFilterType } from "@/lib/eformsign/status-codes";

const INITIAL_VISIBLE_COUNT = 6; // First load: teaser view (4 full + 2 fading)
const PAGE_SIZE = 6; // How many more to show each time
const FETCHING_SKELETON_DURATION_MS = 220;

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
  // Track how many items are visible (starts at 6, increases by 20 each load)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset visible count when filter changes
  useEffect(() => {
    const nextFilterType = filterType;

    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = null;
    }

    queueMicrotask(() => {
      void nextFilterType;
      setVisibleCount(INITIAL_VISIBLE_COUNT);
      setIsFetchingNextPage(false);
    });
  }, [filterType]);

  useEffect(() => {
    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
      }
    };
  }, []);

  // Fetch all documents once
  const query = useQuery<EformsignDocumentsResponse>({
    queryKey: infiniteContractsQueryKeys.documents(filterType),
    queryFn: async () => {
      // Fetch all documents (backend doesn't support pagination)
      const response = await eformsignApi.getAllDocuments();
      return response;
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    refetchOnWindowFocus: false,
  });

  // Process and filter all documents
  const queryDocuments = query.data?.documents;

  const allFilteredDocuments = (() => {
    if (!queryDocuments) return [];

    // Filter by status type
    let docs = filterByActualStatus(queryDocuments, filterType);

    // Filter out excluded names
    if (excludedNames.length > 0) {
      docs = docs.filter((doc) => {
        const name = getCustomerName(doc);
        return name && !excludedNames.includes(name);
      });
    }

    // Sort by created_date
    return sortByCreatedDate(docs);
  })();

  // Slice to visible count
  const documents = useMemo(() => {
    return allFilteredDocuments.slice(0, visibleCount);
  }, [allFilteredDocuments, visibleCount]);

  // Check if there are more items to show
  const hasNextPage = visibleCount < allFilteredDocuments.length;

  // Load more function - just increases visible count
  const fetchNextPage = () => {
    if (isFetchingNextPage || !hasNextPage) return;

    setIsFetchingNextPage(true);

    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
    }

    fetchTimerRef.current = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, allFilteredDocuments.length));
      setIsFetchingNextPage(false);
      fetchTimerRef.current = null;
    }, FETCHING_SKELETON_DURATION_MS);
  };

  return {
    documents,
    isLoading: query.isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredDocuments.length,
    error: query.error,
    refetch: query.refetch,
  };
}
