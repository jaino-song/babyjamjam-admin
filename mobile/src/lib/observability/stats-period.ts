export const STATS_PERIOD_VALUES = [7, 30] as const;

export type StatsPeriod = (typeof STATS_PERIOD_VALUES)[number];

export const DEFAULT_STATS_PERIOD: StatsPeriod = 7;

export interface StatsPeriodOption {
  value: StatsPeriod;
  label: string;
}

export const STATS_PERIOD_OPTIONS: readonly StatsPeriodOption[] = [
  { value: 7, label: "최근 7일" },
  { value: 30, label: "최근 30일" },
];

export function isStatsPeriod(value: unknown): value is StatsPeriod {
  return STATS_PERIOD_VALUES.some((candidate) => candidate === value);
}

export function parseStatsPeriodParam(value: unknown): StatsPeriod | null {
  if (value === undefined || value === null) return DEFAULT_STATS_PERIOD;
  if (Array.isArray(value)) return value.length === 1 ? parseStatsPeriodParam(value[0]) : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && isStatsPeriod(parsed) ? parsed : null;
}

export function getEffectiveStatsPeriod(
  urlPeriod: StatsPeriod,
  optimisticPeriod: StatsPeriod | null,
): StatsPeriod {
  return optimisticPeriod ?? urlPeriod;
}

export interface OptimisticStatsPeriodSelection {
  period: StatsPeriod;
  sourcePeriod: StatsPeriod;
}

export function reconcileOptimisticStatsPeriod(
  urlPeriod: StatsPeriod,
  selection: OptimisticStatsPeriodSelection | null,
): StatsPeriod | null {
  if (!selection || selection.sourcePeriod !== urlPeriod) return null;
  return selection.period;
}

export function statsPeriodLabel(period: StatsPeriod): string {
  return STATS_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "최근 7일";
}
