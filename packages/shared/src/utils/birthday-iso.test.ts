import { formatBirthdayInput, isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "./birthday";

const NOW = new Date("2026-09-17T00:00:00Z");

describe("normalizeBirthdayIsoDate", () => {
    it("preserves an explicit birth century", () => {
        expect(normalizeBirthdayIsoDate("1958-03-03", NOW)).toBe("1958-03-03");
        expect(normalizeBirthdayIsoDate("1905.01.01", NOW)).toBe("1905-01-01");
        expect(normalizeBirthdayIsoDate("2005년 1월 1일", NOW)).toBe("2005-01-01");
    });

    it("reads legacy six-digit birthdays without producing a future year", () => {
        expect(normalizeBirthdayIsoDate("580303", NOW)).toBe("1958-03-03");
        expect(normalizeBirthdayIsoDate("050101", NOW)).toBe("2005-01-01");
    });

    it("rejects invalid dates and future birthdays", () => {
        for (const value of ["1900-02-29", "2005-02-29", "1958-13-03", "2058-03-03"]) {
            expect(normalizeBirthdayIsoDate(value, NOW)).toBeNull();
        }
        expect(normalizeBirthdayIsoDate("2000-02-29", NOW)).toBe("2000-02-29");
    });
});

describe("isValidBirthdayIsoDate", () => {
    it("requires a complete unambiguous date for new input", () => {
        expect(isValidBirthdayIsoDate("1958-03-03", NOW)).toBe(true);
        for (const value of ["580303", "19580303", "1958-3-3", "1958-03", "2058-03-03", ""]) {
            expect(isValidBirthdayIsoDate(value, NOW)).toBe(false);
        }
    });
});

describe("formatBirthdayInput", () => {
    it("keeps four-digit years during typing, paste and deletion", () => {
        expect(formatBirthdayInput("19580303")).toBe("1958-03-03");
        expect(formatBirthdayInput("1958-03-03")).toBe("1958-03-03");
        expect(formatBirthdayInput("19580")).toBe("1958-0");
        expect(formatBirthdayInput("1958-03-0")).toBe("1958-03-0");
        expect(formatBirthdayInput("")).toBe("");
    });
});
