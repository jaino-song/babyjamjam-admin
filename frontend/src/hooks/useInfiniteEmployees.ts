"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useEmployees } from "./useEmployees";
import { formatWorkAreaLabel } from "@/components/app/employees/employee-form.constants";
import { matchesSearchQuery } from "@/lib/search/korean-search";

const INITIAL_VISIBLE_COUNT = 6;
const PAGE_SIZE = 6;
const FETCHING_SKELETON_DURATION_MS = 220;

interface UseInfiniteEmployeesOptions {
  filter?: string;
  search?: string;
}

/**
 * Client-side paginated hook for employees.
 * Fetches all employees once, then reveals them progressively via "load more".
 */
export function useInfiniteEmployees({
  filter = "all",
  search = "",
}: UseInfiniteEmployeesOptions = {}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: employees = [],
    isLoading,
    isError,
    refetch,
  } = useEmployees();

  // Reset visible count when filter/search changes
  useEffect(() => {
    const resetKey = `${filter}:${search}`;

    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = null;
    }

    queueMicrotask(() => {
      void resetKey;
      setVisibleCount(INITIAL_VISIBLE_COUNT);
      setIsFetchingNextPage(false);
    });
  }, [filter, search]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
      }
    };
  }, []);

  // Search is intentionally independent from the availability tab. The
  // directory summary uses this list so its counts describe every matching
  // employee before the active/inactive predicate is applied to the rows.
  const searchMatchedEmployees = useMemo(() => {
    if (!search.trim()) return employees;

    return employees.filter((employee) =>
      matchesSearchQuery(search, [
        employee.name,
        employee.phone,
        ...employee.workArea,
        ...employee.workArea.map(formatWorkAreaLabel),
      ]),
    );
  }, [employees, search]);

  // Filter employees for the progressively visible directory rows.
  const allFilteredEmployees = useMemo(() => {
    if (filter === "active") {
      return searchMatchedEmployees.filter((employee) => employee.openToNextWork === true);
    }

    if (filter === "inactive") {
      return searchMatchedEmployees.filter((employee) => employee.openToNextWork === false);
    }

    return searchMatchedEmployees;
  }, [filter, searchMatchedEmployees]);

  // Slice to visible count
  const visibleEmployees = useMemo(() => {
    return allFilteredEmployees.slice(0, visibleCount);
  }, [allFilteredEmployees, visibleCount]);

  const hasNextPage = visibleCount < allFilteredEmployees.length;

  const fetchNextPage = useCallback(() => {
    if (isFetchingNextPage || !hasNextPage) return;

    setIsFetchingNextPage(true);

    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
    }

    fetchTimerRef.current = setTimeout(() => {
      setVisibleCount((prev) =>
        Math.min(prev + PAGE_SIZE, allFilteredEmployees.length)
      );
      setIsFetchingNextPage(false);
      fetchTimerRef.current = null;
    }, FETCHING_SKELETON_DURATION_MS);
  }, [allFilteredEmployees.length, hasNextPage, isFetchingNextPage]);

  return {
    employees: visibleEmployees,
    allEmployees: employees,
    searchMatchedEmployees,
    searchMatchedCount: searchMatchedEmployees.length,
    filteredCount: allFilteredEmployees.length,
    isLoading,
    isError,
    refetch,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  };
}
