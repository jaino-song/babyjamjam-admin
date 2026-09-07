import { normalizeContractBirthday } from "./birthday";

const now = new Date("2026-09-07T12:00:00+09:00");

describe("normalizeContractBirthday", () => {
    it.each([
        "860709", "19860709", "1986.7.9", "1986-07-09", "1986/7/9",
        "1986년 7월 9일", "1986년7월9일", "1986. 7. 9.", "1986 07 09",
        "86.07.09", "86.7.9", "86/7/9", "86년 7월 9일", "１９８６．７．９",
        " 1986.\u00a07.\u00a09. ", "1986-07-09 00:00:00",
        "1986-07-09T23:00:00-09:00", "1986-07-09T00:00:00.000Z",
    ])("normalizes %s to YYMMDD without shifting the written date", (raw) => {
        expect(normalizeContractBirthday(raw, now)).toBe("860709");
    });

    it.each([
        "1986111", "1986079", "07/09/1986", "03/04/86", "860709abc",
        "1986-07-09Tgarbage", "1986.07/09", "860709-2******", "860709-2123456",
        "1986.02.30", "1900-02-29", "990229", "198679", "2099-07-09",
        "2026-09-08", "260908", "2026-12-31", "1899-07-09", "1986-07-09T24:00:00Z",
        "1986-07-09T00:60:00Z", "1986-07-09T00:00:60Z", "1986-07-09T00:00:00+14:01",
        "1986-07-09T00:00:00+15:00", "1986-07-09T00:00:00+09:60", "1986-07-09.",
        "", "   ", null, undefined,
    ])("rejects unsupported, ambiguous or invalid birthday %s", (raw) => {
        expect(normalizeContractBirthday(raw, now)).toBeNull();
    });

    it("validates leap dates and allows today", () => {
        expect(normalizeContractBirthday("2000년 2월 29일", now)).toBe("000229");
        expect(normalizeContractBirthday("000229", now)).toBe("000229");
        expect(normalizeContractBirthday("2026-09-07", now)).toBe("260907");
    });

    it("uses the Korean calendar date regardless of the process timezone", () => {
        expect(normalizeContractBirthday("2026-09-07", new Date("2026-09-06T15:00:00Z"))).toBe("260907");
        expect(normalizeContractBirthday("2026-09-07", new Date("2026-09-06T14:59:59Z"))).toBeNull();
    });
});
