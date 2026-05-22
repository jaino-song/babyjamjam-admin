"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
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
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  useEffect(() => {
    setVisibleCount((prev) => {
      if (filter === "all" && search === "" && prev === INITIAL_VISIBLE_COUNT) {
        return prev;
      }
      return INITIAL_VISIBLE_COUNT;
    });
  }, [filter, search]);

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

  const allClients = query.data?.data || [];
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

  const clients = useMemo(() => {
    return allFilteredClients.slice(0, visibleCount);
  }, [allFilteredClients, visibleCount]);

  const hasNextPage =
    visibleCount < allFilteredClients.length ||
    (visibleCount === INITIAL_VISIBLE_COUNT &&
      allFilteredClients.length === INITIAL_VISIBLE_COUNT);
  const isInitialLoad = visibleCount <= INITIAL_VISIBLE_COUNT;

  const fetchNextPage = useCallback(() => {
    setVisibleCount((prev) => {
      const next = Math.min(prev + PAGE_SIZE, allFilteredClients.length);
      return next === prev ? prev + PAGE_SIZE : next;
    });
  }, [allFilteredClients.length]);

  return {
    clients,
    allClients,
    allFilteredClients,
    total,
    isLoading: query.isLoading,
    isFetchingNextPage: false,
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredClients.length,
    isInitialLoad,
    error: query.error,
  };
}
