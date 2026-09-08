import {
  getServiceDateDurationCheck,
  getServiceDateDurationPeriodKey,
} from "./duration-mismatch";

describe("getServiceDateDurationCheck", () => {
  it("detects the 15-session versus four-business-day period without changing either value", () => {
    const result = getServiceDateDurationCheck("2026-09-03", "2026-09-08", 15);

    expect(result.businessDays).toBe(4);
    expect(result.hasMismatch).toBe(true);
    expect(result.periodKey).toBe(
      getServiceDateDurationPeriodKey("2026-09-03", "2026-09-08", 15),
    );
  });

  it("does not request confirmation for a matching business-day period", () => {
    const result = getServiceDateDurationCheck("2026-09-03", "2026-09-23", 15);

    expect(result.businessDays).toBe(15);
    expect(result.hasMismatch).toBe(false);
  });

  it.each([0, -1, 1.5, null])("does not treat %s as an allowed positive duration", (duration) => {
    const result = getServiceDateDurationCheck("2026-09-03", "2026-09-08", duration);

    expect(result.hasMismatch).toBe(false);
  });

  it("uses a distinct confirmation key whenever the period changes", () => {
    const original = getServiceDateDurationPeriodKey("2026-09-03", "2026-09-08", 15);
    const changedEndDate = getServiceDateDurationPeriodKey("2026-09-03", "2026-09-09", 15);
    const changedDuration = getServiceDateDurationPeriodKey("2026-09-03", "2026-09-08", 20);

    expect(changedEndDate).not.toBe(original);
    expect(changedDuration).not.toBe(original);
  });
});
