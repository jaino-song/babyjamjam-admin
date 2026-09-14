import { inferVoucherDurationFromAmounts } from "./voucher-duration";

const priceInfos = [
  { duration: "10", fullPrice: "1,464,000", grant: "1,002,000", actualPrice: "462,000" },
  { duration: "15", fullPrice: "2,196,000", grant: "1,303,000", actualPrice: "893,000" },
];

describe("inferVoucherDurationFromAmounts", () => {
  it("infers a unique duration from normalized amount clues", () => {
    expect(inferVoucherDurationFromAmounts(priceInfos, {
      fullPrice: "2,196,000원",
      grant: "1,303,000",
      actualPrice: "893000",
    })).toBe("15");
  });

  it("ignores missing clues and accepts zero as a supplied amount", () => {
    expect(inferVoucherDurationFromAmounts([
      { duration: 5, fullPrice: 0, grant: 100, actualPrice: 0 },
      { duration: 10, fullPrice: 1_000, grant: 800, actualPrice: 200 },
    ], { fullPrice: 0, actualPrice: 0 })).toBe("5");
    expect(inferVoucherDurationFromAmounts(priceInfos, { grant: null })).toBeNull();
  });

  it("returns a shared duration for duplicate rows", () => {
    expect(inferVoucherDurationFromAmounts([
      { duration: "15", fullPrice: "2196000", grant: "1525000", actualPrice: "671000" },
      { duration: "15", fullPrice: "2196000", grant: "1525000", actualPrice: "671000" },
    ], { fullPrice: "2196000" })).toBe("15");
  });

  it("fails closed when a supplied clue contradicts the remaining candidates", () => {
    expect(inferVoucherDurationFromAmounts([
      { duration: "10", fullPrice: "1464000", grant: "1002000" },
      { duration: "15", fullPrice: "2196000", grant: "1303000" },
    ], { fullPrice: "1464000", grant: "1303000" })).toBeNull();
  });

  it("returns null when matching candidates disagree on duration", () => {
    expect(inferVoucherDurationFromAmounts([
      { duration: "10", fullPrice: "1464000" },
      { duration: "15", fullPrice: "1464000" },
    ], { fullPrice: "1464000" })).toBeNull();
  });

  it.each([
    "-1464000",
    "1,46,4000",
    "1,464,000abc",
    "1464 000",
  ])("rejects malformed currency input: %s", (fullPrice) => {
    expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice })).toBeNull();
  });

  it("does not ignore a malformed clue when another amount happens to match", () => {
    expect(inferVoucherDurationFromAmounts(priceInfos, {
      fullPrice: "1,46,4000",
      grant: "1,002,000",
    })).toBeNull();
  });

  it("accepts only plain digits or correctly grouped currency forms", () => {
    expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice: "2,196,000 원" })).toBe("15");
    expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice: "2196000원" })).toBe("15");
    expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice: "0원" })).toBeNull();
  });
});
