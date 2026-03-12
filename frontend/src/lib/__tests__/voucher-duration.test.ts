import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";

describe("inferVoucherDurationFromAmounts", () => {
  it("infers duration from matching price triplet", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "1,464,000", grant: "1,002,000", actualPrice: "462,000" },
          { duration: "15", fullPrice: "2,196,000", grant: "1,303,000", actualPrice: "893,000" },
        ],
        { fullPrice: "2,196,000원", grant: "1,303,000", actualPrice: "893000" }
      )
    ).toBe("15");
  });

  it("infers duration when one amount is missing but remaining amounts uniquely match", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "1464000", grant: "1002000", actualPrice: "462000" },
          { duration: "15", fullPrice: "2196000", grant: "1303000", actualPrice: "893000" },
        ],
        { fullPrice: "1464000", actualPrice: "462000" }
      )
    ).toBe("10");
  });

  it("returns the shared duration when multiple voucher types have the same duration", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "15", fullPrice: "2196000", grant: "1525000", actualPrice: "671000" },
          { duration: "15", fullPrice: "2196000", grant: "1525000", actualPrice: "671000" },
        ],
        { fullPrice: "2196000", grant: "1525000", actualPrice: "671000" }
      )
    ).toBe("15");
  });

  it("returns null when matched candidates still disagree on duration", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "1464000" },
          { duration: "15", fullPrice: "1464000" },
        ],
        { fullPrice: "1464000" }
      )
    ).toBeNull();
  });
});
