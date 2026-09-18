import { api } from "@/lib/api/client";
import type { StatsViewData, StatsViewResponse } from "@/lib/observability/stats-server";
import type { StatsPeriod } from "@/lib/observability/stats-period";

export type StatsView = keyof StatsViewData;

export async function getStatsView<TView extends StatsView>(view: TView, period?: StatsPeriod): Promise<StatsViewResponse<TView>> {
  const endpoint = `/stats/${encodeURIComponent(view)}`;
  const url = period === undefined ? endpoint : `${endpoint}?period=${period}`;
  const { data } = await api.get(url);
  return data as StatsViewResponse<TView>;
}
