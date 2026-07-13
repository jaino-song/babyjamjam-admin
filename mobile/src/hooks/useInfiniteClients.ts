"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Client, PaginatedResponse } from "@/lib/client/types";
import { clientQueryKeys } from "./useClients";

const INITIAL_VISIBLE_COUNT = 6;
const PAGE_SIZE = 6;
const API_PAGE_SIZE = 50;
const MAX_CLIENT_PAGES = 50;

interface UseInfiniteClientsOptions {
  filter?: string;
  search?: string;
  filterFn?: (client: Client, filterValue: string) => boolean;
  searchFn?: (client: Client, query: string) => boolean;
}

function resolveTotalPages(response: PaginatedResponse<Client>): number {
  if (Number.isInteger(response.totalPages) && response.totalPages > 0) {
    return Math.min(response.totalPages, MAX_CLIENT_PAGES);
  }

  const total = Number.isFinite(response.total) ? response.total : response.data.length;
  return Math.min(Math.max(1, Math.ceil(total / API_PAGE_SIZE)), MAX_CLIENT_PAGES);
}

async function fetchClientPage(page: number): Promise<PaginatedResponse<Client>> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(API_PAGE_SIZE));
  const { data } = await api.get(`/clients?${params.toString()}`);
  return data;
}

async function fetchAllClientPages(): Promise<PaginatedResponse<Client>> {
  const firstPage = await fetchClientPage(1);
  const totalPages = resolveTotalPages(firstPage);

  if (totalPages <= 1) {
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => fetchClientPage(index + 2)),
  );
  const allData = [firstPage, ...remainingPages].flatMap((page) => page.data);

  return {
    ...firstPage,
    data: allData,
    total: Number.isFinite(firstPage.total) ? firstPage.total : allData.length,
    page: 1,
    limit: API_PAGE_SIZE,
    totalPages,
  };
}

export function useInfiniteClients({
  filter = "all",
  search = "",
  filterFn,
  searchFn,
}: UseInfiniteClientsOptions = {}) {
  const resetKey = `${filter}::${search}`;
  const [visibleState, setVisibleState] = useState({
    key: resetKey,
    count: INITIAL_VISIBLE_COUNT,
  });

  const query = useQuery<PaginatedResponse<Client>>({
    queryKey: [...clientQueryKeys.lists(), { scope: "all-pages", limit: API_PAGE_SIZE }] as const,
    queryFn: fetchAllClientPages,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });

  const allClients = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const total = query.data?.total ?? allClients.length;

  const allFilteredClients = useMemo(() => {
    let list = allClients;

    if (filter !== "all" && filterFn) {
      list = list.filter((c) => filterFn(c, filter));
    }

    if (search.trim() && searchFn) {
      list = list.filter((c) => searchFn(c, search.trim()));
    }

    return list;
  }, [allClients, filter, search, filterFn, searchFn]);

  const visibleCount = Math.min(
    visibleState.key === resetKey ? visibleState.count : INITIAL_VISIBLE_COUNT,
    allFilteredClients.length,
  );

  const clients = useMemo(() => {
    return allFilteredClients.slice(0, visibleCount);
  }, [allFilteredClients, visibleCount]);

  const hasNextPage = visibleCount < allFilteredClients.length;
  const isInitialLoad = visibleCount <= INITIAL_VISIBLE_COUNT;

  const fetchNextPage = useCallback(() => {
    setVisibleState((current) => {
      const currentCount = Math.min(
        current.key === resetKey ? current.count : INITIAL_VISIBLE_COUNT,
        allFilteredClients.length,
      );
      const nextCount = Math.min(currentCount + PAGE_SIZE, allFilteredClients.length);

      if (current.key === resetKey && current.count === nextCount) {
        return current;
      }

      return {
        key: resetKey,
        count: nextCount,
      };
    });
  }, [allFilteredClients.length, resetKey]);

  return {
    clients,
    allClients,
    allFilteredClients,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: false,
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredClients.length,
    isInitialLoad,
    error: query.error,
  };
}
