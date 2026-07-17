import { formatDateForDisplay } from "./format-date-for-display";

describe("formatDateForDisplay", () => {
  it("formats date-only values with zero-padded dots", () => {
    expect(formatDateForDisplay("2026-07-14")).toBe("2026.07.14");
  });

  it("preserves the calendar date from ISO date strings", () => {
    expect(formatDateForDisplay("2026-07-14T15:00:00.000Z")).toBe("2026.07.15");
  });

  it("returns the fallback for empty or invalid values", () => {
    expect(formatDateForDisplay(null)).toBe("-");
    expect(formatDateForDisplay("invalid")).toBe("-");
  });
});
