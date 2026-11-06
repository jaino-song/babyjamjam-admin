import { formatVoucherDurationLabel } from "./voucher-duration-label";

describe("formatVoucherDurationLabel", () => {
  it.each([
    [5, [5, 10, 15], "5일 (단축형)"],
    [10, [5, 10, 15], "10일 (표준형)"],
    [15, [5, 10, 15], "15일 (연장형)"],
    [10, [10, 15, 20], "10일 (단축형)"],
    [15, [10, 15, 20], "15일 (표준형)"],
    [20, [10, 15, 20], "20일 (연장형)"],
  ])("ranks %s within %j", (duration, availableDurations, expected) => {
    expect(formatVoucherDurationLabel(duration, availableDurations)).toBe(expected);
  });

  it("sorts and deduplicates without mutating the source", () => {
    const durations = Object.freeze([15, 5, 10, 5, 15]);

    expect(formatVoucherDurationLabel(10, durations)).toBe("10일 (표준형)");
    expect(durations).toEqual([15, 5, 10, 5, 15]);
  });

  it("ignores values that are not positive finite integers", () => {
    expect(formatVoucherDurationLabel(10, [NaN, Infinity, -Infinity, -5, 0, 7.5, 15, 5, 10]))
      .toBe("10일 (표준형)");
  });

  it.each([
    [10, []],
    [10, [10]],
    [10, [5, 10]],
    [10, [5, 10, 15, 20]],
    [20, [5, 10, 15]],
    [0, [5, 10, 15]],
    [7.5, [5, 10, 15]],
    [10, [0, -5, NaN, Infinity, 7.5, 10]],
  ])("uses the plain label for %s with incomplete or unmatched data %j", (duration, availableDurations) => {
    expect(formatVoucherDurationLabel(duration, availableDurations)).toBe(`${duration}일`);
  });
});
