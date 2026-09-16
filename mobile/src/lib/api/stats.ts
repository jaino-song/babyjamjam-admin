import { api } from "@/lib/api/client";
import type { StatsViewData, StatsViewResponse } from "@/lib/observability/stats-server";

export type StatsView = keyof StatsViewData;

export async function getStatsView<TView extends StatsView>(view: TView): Promise<StatsViewResponse<TView>> {
  const { data } = await api.get(`/stats/${encodeURIComponent(view)}`);
  return data as StatsViewResponse<TView>;
}
