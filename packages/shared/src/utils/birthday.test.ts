import { formatBirthdayYYMMDD } from "./birthday";

describe("formatBirthdayYYMMDD", () => {
    it("formats a 20xx birthday (two-digit year below the century pivot)", () => {
        expect(formatBirthdayYYMMDD("000229")).toBe("2000.02.29"); // leap day
        expect(formatBirthdayYYMMDD("050101")).toBe("2005.01.01");
    });

    it("formats a 19xx birthday (two-digit year at/above the century pivot)", () => {
        expect(formatBirthdayYYMMDD("960414")).toBe("1996.04.14");
        expect(formatBirthdayYYMMDD("700101")).toBe("1970.01.01"); // pivot boundary itself
    });

    it("returns the original string when it is not exactly 6 digits", () => {
        expect(formatBirthdayYYMMDD("abc")).toBe("abc");
        expect(formatBirthdayYYMMDD("12345")).toBe("12345");
        expect(formatBirthdayYYMMDD("1234567")).toBe("1234567");
        expect(formatBirthdayYYMMDD("")).toBe("");
    });

    it("returns the original string when the 6 digits do not resolve to a real calendar date", () => {
        expect(formatBirthdayYYMMDD("991332")).toBe("991332"); // month 13
        expect(formatBirthdayYYMMDD("990230")).toBe("990230"); // Feb 30 never exists
        expect(formatBirthdayYYMMDD("990229")).toBe("990229"); // 1999 is not a leap year
    });
});
