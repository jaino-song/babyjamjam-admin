"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { formatWorkAreaLabel } from "@/components/app/employees/employee-form.constants";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { Employee, employeeQueryKeys } from "./useEmployees";

const INITIAL_VISIBLE_COUNT = 6;
const PAGE_SIZE = 6;

interface UseInfiniteEmployeesOptions {
  filter?: string;
  search?: string;
}

export function useInfiniteEmployees({
  filter = "all",
  search = "",
}: UseInfiniteEmployeesOptions = {}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const normalizePhoneDigits = useCallback((value: string) => value.replace(/\D/g, ""), []);

  useEffect(() => {
    const resetKey = `${filter}:${search}`;

    queueMicrotask(() => {
      void resetKey;
      setVisibleCount(INITIAL_VISIBLE_COUNT);
    });
  }, [filter, search]);

  const query = useQuery<Employee[]>({
    queryKey: employeeQueryKeys.lists(),
    queryFn: async () => {
      const { data } = await api.get("/employees");
      return data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });

  const allFilteredEmployees = useMemo(() => {
    let list = query.data || [];

    if (filter === "active") {
      list = list.filter((e) => e.openToNextWork);
    } else if (filter === "inactive") {
      list = list.filter((e) => !e.openToNextWork);
    }

    if (search.trim()) {
      const query = search.trim();
      const lowerQuery = query.toLowerCase();
      const phoneQuery = normalizePhoneDigits(query);

      list = list.filter(
        (employee) =>
          matchesKoreanSearch(employee.name, query) ||
          (phoneQuery.length > 0 && normalizePhoneDigits(employee.phone).includes(phoneQuery)) ||
          employee.workArea.some((area) => {
            const formattedArea = formatWorkAreaLabel(area).toLowerCase();
            const rawArea = area.toLowerCase();

            return rawArea.includes(lowerQuery) || formattedArea.includes(lowerQuery);
          })
      );
    }

    return list;
  }, [query.data, filter, normalizePhoneDigits, search]);

  const employees = useMemo(() => {
    return allFilteredEmployees.slice(0, visibleCount);
  }, [allFilteredEmployees, visibleCount]);

  const hasNextPage = visibleCount < allFilteredEmployees.length;
  const isInitialLoad = visibleCount <= INITIAL_VISIBLE_COUNT;

  const fetchNextPage = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, allFilteredEmployees.length));
  }, [allFilteredEmployees.length]);

  return {
    employees,
    allEmployees: query.data || [],
    isLoading: query.isLoading,
    isFetchingNextPage: false,
    hasNextPage,
    fetchNextPage,
    totalCount: allFilteredEmployees.length,
    isInitialLoad,
    error: query.error,
  };
}
