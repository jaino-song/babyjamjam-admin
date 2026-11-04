"use client";

import { useQuery } from "@tanstack/react-query";

import { isBranchContextAligned } from "@/features/system-templates/branch-context";

import { api } from "@/lib/api/client";
import type { Client, PaginatedResponse } from "@/lib/client/types";

export interface DashboardStats {
  activeClients: number;
  contractsNotSent: number;
  contractsPendingSignature: number;
  upcomingThisMonth: number;
  upcomingNextMonth: number;
}

export const dashboardQueryKeys = {
  stats: (branchId?: string | null) => branchId === undefined
    ? ["dashboard", "stats"] as const
    : ["dashboard", "stats", { branchId }] as const,
  overview: (limit: number) => ["dashboard", "overview", { limit }] as const,
  /** Prefix key matching every `overview(limit)` query, for broad invalidation. */
  overviewAll: () => ["dashboard", "overview"] as const,
};

export interface DashboardOverview {
  stats: DashboardStats;
  clients: PaginatedResponse<Client>;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch("/api/clients/stats");
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats: ${response.status}`);
  }
  return response.json();
}

export function useDashboardStats(options: { branchId?: string | null; enabled?: boolean } = {}) {
  const scoped = options.branchId !== undefined;
  const ready = options.enabled !== false && (!scoped || isBranchContextAligned(options.branchId ?? null));
  const query = useQuery<DashboardStats>({
    queryKey: dashboardQueryKeys.stats(options.branchId),
    queryFn: () => {
      if (options.enabled === false || (scoped && !isBranchContextAligned(options.branchId ?? null))) {
        throw new Error("Branch selection required");
      }
      return fetchDashboardStats();
    },
    enabled: ready,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  return { ...query, data: ready ? query.data : undefined };
}

export async function fetchDashboardClientPage(page: number, limit: number): Promise<PaginatedResponse<Client>> {
  const { data } = await api.get<PaginatedResponse<Client>>("/clients", {
    params: { page, limit },
  });
  return data;
}

async function fetchDashboardOverview(limit: number): Promise<DashboardOverview> {
  const { data } = await api.get<DashboardOverview>("/dashboard/overview", {
    params: { limit },
  });
  return data;
}

export function useDashboardOverview(limit = 50) {
  return useQuery<DashboardOverview>({
    queryKey: dashboardQueryKeys.overview(limit),
    queryFn: () => fetchDashboardOverview(limit),
    staleTime: 5 * 60 * 1000,
  });
}
