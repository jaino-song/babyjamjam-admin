"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { ActionRequiredReason, ActionRequiredStatus } from "@/lib/client/action-required";

export interface ClientActionRequiredAlert {
  id: number;
  name: string;
  createdAt: string | null;
  reason: ActionRequiredReason;
  priority: ActionRequiredStatus["priority"];
}

export const clientAlertQueryKeys = {
  all: ["clients", "alerts"] as const,
  list: (limit: number) => [...clientAlertQueryKeys.all, { limit }] as const,
};

export function useClientAlerts(limit = 3, enabled = true) {
  return useQuery<ClientActionRequiredAlert[]>({
    queryKey: clientAlertQueryKeys.list(limit),
    queryFn: async () => {
      const { data } = await api.get<ClientActionRequiredAlert[]>("/clients/alerts", {
        params: { limit },
      });
      return data;
    },
    enabled,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
}
