import { isStrictIsoDate, isoToYymmdd, normalizeIsoDate, todayIsoDate, yymmddToIso } from "../date-input";

describe("contract date input helpers", () => {
  it("converts valid YYMMDD input to ISO dates", () => {
    expect(yymmddToIso("260603")).toBe("2026-06-03");
    expect(yymmddToIso("240229")).toBe("2024-02-29");
  });

  it("rejects impossible YYMMDD calendar dates", () => {
    expect(yymmddToIso("260230")).toBe("");
    expect(yymmddToIso("260431")).toBe("");
    expect(yymmddToIso("230229")).toBe("");
  });

  it("validates exact ISO calendar dates", () => {
    expect(isStrictIsoDate("2026-06-03")).toBe(true);
    expect(isStrictIsoDate("2026-02-30")).toBe(false);
    expect(isStrictIsoDate("2026-04-31")).toBe(false);
    expect(isStrictIsoDate("2026-06-03T00:00:00.000Z")).toBe(false);
  });

  it("normalizes valid ISO datetime prefixes and rejects invalid prefixes", () => {
    expect(normalizeIsoDate("2026-06-03T00:00:00.000Z")).toBe("2026-06-03");
    expect(normalizeIsoDate("2026-02-30T00:00:00.000Z")).toBe("");
  });

  it("converts normalized ISO values back to YYMMDD display input", () => {
    expect(isoToYymmdd("2026-06-03T00:00:00.000Z")).toBe("260603");
    expect(isoToYymmdd("2026-02-30T00:00:00.000Z")).toBe("");
  });

  it("formats today's local calendar date as ISO", () => {
    expect(todayIsoDate(new Date(2026, 5, 4))).toBe("2026-06-04");
  });
});
