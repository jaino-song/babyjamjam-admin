"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";
import { messagePolicyApi } from "@/services/settings";

const settingsKey = (branchId: string) => ["settings", "canceled-automation-retry", branchId] as const;

function assertBranchContext(branchId: string) {
  if (!isBranchContextAligned(branchId)) {
    throw new Error("지점이 변경됐어요. 화면을 새로고침한 뒤 다시 시도해 주세요.");
  }
}

export function useCanceledAutomationRetrySettings(branchId: string) {
  return useQuery({
    queryKey: settingsKey(branchId),
    queryFn: ({ signal }) => {
      assertBranchContext(branchId);
      return messagePolicyApi.listCanceledAutomationRetries(branchId, signal);
    },
  });
}

export function useUpdateCanceledAutomationRetry(branchId: string, id: string) {
  const queryClient = useQueryClient();
  const queryKey = settingsKey(branchId);
  return useMutation({
    mutationFn: (enabled: boolean) => {
      assertBranchContext(branchId);
      return messagePolicyApi.updateCanceledAutomationRetry(id, { enabled }, branchId);
    },
    // Re-read the submitted branch after success or failure. A delayed save
    // response can be older than another save that already committed.
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
}
