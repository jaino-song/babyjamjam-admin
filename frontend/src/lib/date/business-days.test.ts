import { calcEndDateBusinessDays, diffBusinessDaysKr, isBusinessDayKr } from "./business-days";

describe("Korean business-day helpers", () => {
    it("counts the start date as the first service day when it is a business day", () => {
        expect(calcEndDateBusinessDays("2026-01-05", 1)).toBe("2026-01-05");
    });

    it("skips weekends when calculating the service end date", () => {
        expect(calcEndDateBusinessDays("2026-01-02", 2)).toBe("2026-01-05");
    });

    it("starts counting from the next business day when the start date is a holiday", () => {
        expect(calcEndDateBusinessDays("2026-01-01", 1)).toBe("2026-01-02");
    });

    it("skips Korean holidays from the mobile source-of-truth list", () => {
        expect(isBusinessDayKr("2026-06-03")).toBe(false);
        expect(calcEndDateBusinessDays("2026-06-02", 2)).toBe("2026-06-04");
    });

    it("returns an empty string for invalid inputs", () => {
        expect(calcEndDateBusinessDays("", 10)).toBe("");
        expect(calcEndDateBusinessDays("260602", 10)).toBe("");
        expect(calcEndDateBusinessDays("2026-06-02", 0)).toBe("");
    });

    it("counts business-day distance while skipping weekends and holidays", () => {
        expect(diffBusinessDaysKr("2026-07-08", "2026-07-07")).toBe(1);
        expect(diffBusinessDaysKr("2026-07-06", "2026-07-07")).toBe(-1);
        expect(diffBusinessDaysKr("2026-07-20", "2026-07-07")).toBe(8);
        expect(diffBusinessDaysKr("2026-06-04", "2026-06-02")).toBe(1);
    });
});
