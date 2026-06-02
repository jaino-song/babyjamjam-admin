"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Client, PaginatedResponse } from "@/lib/client/types";
import { clientQueryKeys } from "./useClients";

const INITIAL_VISIBLE_COUNT = 6;
const PAGE_SIZE = 6;

interface UseInfiniteClientsOptions {
  filter?: string;
  search?: string;
  filterFn?: (client: Client, filterValue: string) => boolean;
  searchFn?: (client: Client, query: string) => boolean;
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
    queryKey: clientQueryKeys.list(1, 50),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "50");
      const { data } = await api.get(`/clients?${params.toString()}`);
      return data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });

  const allClients = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const total = query.data?.total || 0;

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
