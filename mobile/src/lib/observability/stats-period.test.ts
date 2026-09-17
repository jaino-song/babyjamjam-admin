import {
  DEFAULT_STATS_PERIOD,
  getEffectiveStatsPeriod,
  parseStatsPeriodParam,
  type OptimisticStatsPeriodSelection,
  reconcileOptimisticStatsPeriod,
  statsPeriodLabel,
} from "./stats-period";

describe("stats period", () => {
  it("defaults an omitted period to seven days", () => {
    expect(parseStatsPeriodParam(undefined)).toBe(DEFAULT_STATS_PERIOD);
  });

  it("accepts only the allowlisted seven and thirty day values", () => {
    expect(parseStatsPeriodParam("7")).toBe(7);
    expect(parseStatsPeriodParam("30")).toBe(30);
    expect(parseStatsPeriodParam("14")).toBeNull();
    expect(parseStatsPeriodParam("7 OR 1=1")).toBeNull();
    expect(parseStatsPeriodParam(["7", "30"])).toBeNull();
  });

  it("provides honest labels for selected ranges", () => {
    expect(statsPeriodLabel(7)).toBe("최근 7일");
    expect(statsPeriodLabel(30)).toBe("최근 30일");
  });

  it("keeps the optimistic period while search params are still stale", () => {
    const selection: OptimisticStatsPeriodSelection = { period: 30, sourcePeriod: 7 };
    expect(getEffectiveStatsPeriod(7, 30)).toBe(30);
    expect(reconcileOptimisticStatsPeriod(7, selection)).toBe(30);
    expect(reconcileOptimisticStatsPeriod(30, selection)).toBeNull();
    expect(reconcileOptimisticStatsPeriod(7, null)).toBeNull();
  });
});
