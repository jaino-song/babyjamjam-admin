import type { ClientListTab } from "../types";

export interface ClientListKeyFilters {
  page?: number;
  limit?: number;
  search?: string;
  tab?: ClientListTab;
  branchId?: string | null;
}

export interface ClientDirectoryKeyFilters {
  branchId?: string | null;
  limit?: number;
  search?: string;
  tab?: ClientListTab;
}

export interface ClientSummaryKeyFilters {
  branchId?: string | null;
  search?: string;
}

const UNAVAILABLE_BRANCH = "unavailable";

function branchScope(branchId: string | null | undefined): string {
  return branchId ?? UNAVAILABLE_BRANCH;
}

function searchScope(search: string | undefined): string {
  return search ?? "";
}

/**
 * Query Key Factory for Clients.
 *
 * Every branch-owned list representation remains below `clientKeys.all`, so
 * existing mutation invalidation refreshes both rows and summary metrics.
 */
export const clientKeys = {
  all: ["clients"] as const,
  lists: () => [...clientKeys.all, "list"] as const,
  list: (filters: ClientListKeyFilters) =>
    [...clientKeys.lists(), "page", {
      branchId: branchScope(filters.branchId),
      page: filters.page,
      limit: filters.limit,
      search: searchScope(filters.search),
      tab: filters.tab ?? "all",
    }] as const,
  directory: (filters: ClientDirectoryKeyFilters) =>
    [...clientKeys.lists(), "directory", {
      branchId: branchScope(filters.branchId),
      limit: filters.limit,
      search: searchScope(filters.search),
      tab: filters.tab ?? "all",
    }] as const,
  allClients: (branchId?: string | null) =>
    [...clientKeys.lists(), "all", branchScope(branchId)] as const,
  summaries: () => [...clientKeys.lists(), "summary"] as const,
  summary: (filters: ClientSummaryKeyFilters) =>
    [...clientKeys.summaries(), {
      branchId: branchScope(filters.branchId),
      search: searchScope(filters.search),
    }] as const,
  details: () => [...clientKeys.all, "detail"] as const,
  detail: (id: number) => [...clientKeys.details(), id] as const,
};
