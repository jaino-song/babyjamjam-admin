import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";

const priceInfos = [
  { duration: "10", fullPrice: "1,464,000", grant: "1,002,000", actualPrice: "462,000" },
  { duration: "15", fullPrice: "2,196,000", grant: "1,303,000", actualPrice: "893,000" },
];

describe("inferVoucherDurationFromAmounts", () => {
  it("infers a unique duration from all supplied amount clues", () => {
    expect(
      inferVoucherDurationFromAmounts(priceInfos, {
        fullPrice: "2,196,000원",
        grant: "1,303,000",
        actualPrice: "893000",
      })
    ).toBe("15");
  });

  it("ignores missing clues when the remaining clue uniquely matches", () => {
    expect(
      inferVoucherDurationFromAmounts(priceInfos, {
        fullPrice: "1,464,000",
        actualPrice: "462,000",
      })
    ).toBe("10");
  });

  it("accepts zero as a supplied amount", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: 5, fullPrice: 0, grant: 100, actualPrice: 0 },
          { duration: 10, fullPrice: 1_000, grant: 800, actualPrice: 200 },
        ],
        { fullPrice: "0원", actualPrice: 0 }
      )
    ).toBe("5");
  });

  it("returns a shared duration for duplicate price rows", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "15", fullPrice: "2,196,000", grant: "1,525,000", actualPrice: "671,000" },
          { duration: "15", fullPrice: "2,196,000", grant: "1,525,000", actualPrice: "671,000" },
        ],
        { fullPrice: "2196000" }
      )
    ).toBe("15");
  });

  it("returns null when matching candidates disagree on duration", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "1,464,000" },
          { duration: "15", fullPrice: "1,464,000" },
        ],
        { fullPrice: "1,464,000" }
      )
    ).toBeNull();
  });

  it("fails closed when supplied amounts conflict", () => {
    expect(
      inferVoucherDurationFromAmounts(priceInfos, {
        fullPrice: "1,464,000",
        grant: "1,303,000",
      })
    ).toBeNull();
  });

  it.each(["-1,464,000", "1,46,4000", "1,464,000abc", "1 464 000"])(
    "returns null for malformed amount values: %s",
    (fullPrice) => {
      expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice })).toBeNull();
    }
  );

  it("returns null when no amount clue is supplied", () => {
    expect(inferVoucherDurationFromAmounts(priceInfos, { fullPrice: null, grant: "" })).toBeNull();
  });
});
