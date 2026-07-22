import {
  findOutOfPocketPriceInfo,
  formatOutOfPocketDurationLabel,
} from "./out-of-pocket-pricing";

describe("out-of-pocket pricing", () => {
  const priceInfos = [
    { duration: 5, fullPrice: "815000" },
    { duration: 10, fullPrice: "1620000" },
    { duration: 15, fullPrice: "2425000" },
    { duration: 20, fullPrice: "3240000" },
  ];

  it.each([
    [5, "1주 (5일)"],
    [10, "2주 (10일)"],
    [15, "3주 (15일)"],
    [20, "4주 (20일)"],
  ])("formats %i days as %s", (duration, expected) => {
    expect(formatOutOfPocketDurationLabel(duration)).toBe(expected);
  });

  it("finds the DB price for the selected duration", () => {
    expect(findOutOfPocketPriceInfo(priceInfos, 15)).toEqual({
      duration: 15,
      fullPrice: "2425000",
    });
  });

  it("returns null when no DB price exists for the duration", () => {
    expect(findOutOfPocketPriceInfo(priceInfos, 25)).toBeNull();
  });
});
