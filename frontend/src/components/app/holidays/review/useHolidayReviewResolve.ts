import { useMutation, useQueryClient } from "@tanstack/react-query";

import { clientKeys } from "@/features/clients/hooks/keys";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import {
  holidayReviewApi,
  holidayReviewKeys,
  type HolidayReviewResolveAction,
} from "@/services/holiday-review";

import { describeSkipCode } from "./review-format";

export interface ReviewItemRef {
  id: string;
  clientName: string;
}

export interface ReviewResolveSummary {
  action: HolidayReviewResolveAction;
  fixed: number;
  kept: number;
  skipped: { itemId: string; name: string | null; reason: string }[];
}

export interface ReviewResolveInput {
  eventId: string;
  action: HolidayReviewResolveAction;
  /** The rows to act on, or every open safe row of the event (looked up at submit time). */
  selection: readonly ReviewItemRef[] | "all-safe";
}

/**
 * Resolves (fixes or keeps) review items and refreshes everything that shows them or the end dates they
 * change: the review lists, the client lists/details and the dashboard.
 */
export function useHolidayReviewResolve(branchId: string) {
  const queryClient = useQueryClient();

  return useMutation<ReviewResolveSummary, unknown, ReviewResolveInput>({
    mutationFn: async ({ eventId, action, selection }) => {
      const refs =
        selection === "all-safe"
          ? (await holidayReviewApi.listItems(branchId, eventId, { category: "safe", status: "open" })).map(
              (item) => ({ id: item.id, clientName: item.clientName }),
            )
          : selection;
      if (refs.length === 0) return { action, fixed: 0, kept: 0, skipped: [] };

      const result = await holidayReviewApi.resolve(
        branchId,
        eventId,
        refs.map((ref) => ref.id),
        action,
      );
      const names = new Map(refs.map((ref) => [ref.id, ref.clientName]));
      return {
        action,
        fixed: result.fixed,
        kept: result.kept,
        skipped: result.skipped.map((skip) => ({
          itemId: skip.itemId,
          name: names.get(skip.itemId) ?? null,
          reason: describeSkipCode(skip.code),
        })),
      };
    },
    // Settled, not success: a chunked run can fail part-way after some clients were already changed.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: holidayReviewKeys.events(branchId) }),
        queryClient.invalidateQueries({ queryKey: holidayReviewKeys.itemsAll(branchId) }),
        queryClient.invalidateQueries({ queryKey: clientKeys.all }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.overviewAll() }),
      ]);
    },
  });
}
