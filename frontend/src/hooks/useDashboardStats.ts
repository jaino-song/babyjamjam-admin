"use client";

import { useQuery } from "@tanstack/react-query";

export interface DashboardStats {
  activeClients: number;
  contractsNotSent: number;
  contractsPendingSignature: number;
  upcomingThisMonth: number;
  upcomingNextMonth: number;
}

export const dashboardQueryKeys = {
  stats: () => ["dashboard", "stats"] as const,
};

async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch("/api/clients/stats");
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats: ${response.status}`);
  }
  return response.json();
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: dashboardQueryKeys.stats(),
    queryFn: fetchDashboardStats,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
