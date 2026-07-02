import {
    addBusinessDaysKr,
    isBusinessDayKr,
    nextBusinessDayKr,
} from "domain/utils/business-days";

describe("Korean business day utilities", () => {
    describe("nextBusinessDayKr", () => {
        it("should skip a weekend from Friday to Monday", () => {
            expect(nextBusinessDayKr("2026-07-03")).toBe("2026-07-06");
        });

        it("should skip the 2026 Seollal holiday run", () => {
            expect(nextBusinessDayKr("2026-02-13")).toBe("2026-02-19");
        });

        it("should skip Liberation Day and its substitute holiday", () => {
            expect(nextBusinessDayKr("2026-08-14")).toBe("2026-08-18");
        });

        it("should skip New Year's Day and the following weekend across year boundary", () => {
            expect(nextBusinessDayKr("2026-12-31")).toBe("2027-01-04");
        });
    });

    describe("addBusinessDaysKr", () => {
        it("should return the original date for non-positive offsets", () => {
            expect(addBusinessDaysKr("2026-07-03", 0)).toBe("2026-07-03");
            expect(addBusinessDaysKr("2026-07-03", -1)).toBe("2026-07-03");
        });

        it("should add Korean business days", () => {
            expect(addBusinessDaysKr("2026-07-03", 2)).toBe("2026-07-07");
        });
    });

    describe("isBusinessDayKr", () => {
        it("should identify weekdays, weekends, holidays, and empty input", () => {
            expect(isBusinessDayKr("2026-07-06")).toBe(true);
            expect(isBusinessDayKr("2026-07-04")).toBe(false);
            expect(isBusinessDayKr("2026-02-16")).toBe(false);
            expect(isBusinessDayKr("")).toBe(false);
        });
    });
});
