"use client";

import { useQuery } from "@tanstack/react-query";
import {
  normalizeDashboardAnalyticsPayload,
  type DashboardAnalytics,
} from "@/lib/dashboard/analytics";

export type { DashboardAnalytics } from "@/lib/dashboard/analytics";

export const dashboardQueryKeys = {
  analytics: () => ["dashboard", "analytics"] as const,
};

async function fetchDashboardAnalytics(): Promise<DashboardAnalytics> {
  const response = await fetch("/api/clients/analytics");
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard analytics: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const analytics = normalizeDashboardAnalyticsPayload(payload);
  if (!analytics) {
    throw new Error("Failed to normalize dashboard analytics response");
  }
  return analytics;
}

export function useDashboardAnalytics() {
  return useQuery<DashboardAnalytics>({
    queryKey: dashboardQueryKeys.analytics(),
    queryFn: fetchDashboardAnalytics,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
