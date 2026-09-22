import {
  DEFAULT_STATS_PERIOD,
  parseStatsPeriodParam,
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
});
