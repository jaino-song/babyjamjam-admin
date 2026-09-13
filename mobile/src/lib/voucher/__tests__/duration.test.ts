import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";

describe("inferVoucherDurationFromAmounts", () => {
  it("infers a duration when multiple provided amounts consistently match one candidate", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "1,464,000", grant: "1,002,000", actualPrice: "462,000" },
          { duration: "15", fullPrice: "2,196,000", grant: "1,303,000", actualPrice: "893,000" },
        ],
        { fullPrice: "2,196,000원", grant: "1,303,000", actualPrice: "893000" },
      ),
    ).toBe("15");
  });

  it("returns null when a grant contradicts an earlier full-price match", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "100,000", grant: "50,000" },
          { duration: "15", fullPrice: "200,000", grant: "80,000" },
        ],
        { fullPrice: "100,000", grant: "80,000" },
      ),
    ).toBeNull();
  });

  it("returns null when a full price contradicts a later grant match", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "100,000", grant: "50,000" },
          { duration: "15", fullPrice: "200,000", grant: "80,000" },
        ],
        { fullPrice: "300,000", grant: "50,000" },
      ),
    ).toBeNull();
  });

  it("ignores missing amounts while retaining the clues that were supplied", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "100,000", grant: "50,000" },
          { duration: "15", fullPrice: "200,000", grant: "80,000" },
        ],
        { fullPrice: "100,000", grant: "" },
      ),
    ).toBe("10");
  });

  it("treats zero as a supplied amount rather than a missing clue", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "100,000", grant: "0" },
          { duration: "15", fullPrice: "100,000", grant: "80,000" },
        ],
        { fullPrice: "100,000", grant: 0 },
      ),
    ).toBe("10");
  });

  it("returns null when matching candidates disagree on duration", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "10", fullPrice: "100,000" },
          { duration: "15", fullPrice: "100,000" },
        ],
        { fullPrice: "100,000" },
      ),
    ).toBeNull();
  });

  it("returns the shared duration when matching candidates have the same duration", () => {
    expect(
      inferVoucherDurationFromAmounts(
        [
          { duration: "15", fullPrice: "100,000", grant: "50,000" },
          { duration: "15", fullPrice: "100,000", grant: "50,000" },
        ],
        { fullPrice: "100,000", grant: "50,000" },
      ),
    ).toBe("15");
  });
});
