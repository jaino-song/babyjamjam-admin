import { canEditDailyRecord, isDayButtonDisabled } from "../[token]/page";

describe("canEditDailyRecord", () => {
    it("allows an existing record to be edited outside the service date", () => {
        expect(canEditDailyRecord(true, "2026-07-14", "2026-07-15")).toBe(true);
    });

    it("keeps the same-day gate for a new record", () => {
        expect(canEditDailyRecord(false, "2026-07-14", "2026-07-15")).toBe(false);
        expect(canEditDailyRecord(false, "2026-07-15", "2026-07-15")).toBe(true);
    });

    it("allows a new record outside the service date when the dev override is enabled", () => {
        expect(canEditDailyRecord(false, "2026-07-14", "2026-07-15", true)).toBe(true);
    });

    it("keeps the same-day gate when the dev override is disabled", () => {
        expect(canEditDailyRecord(false, "2026-07-14", "2026-07-15", false)).toBe(false);
    });
});

describe("isDayButtonDisabled", () => {
    it("keeps a completed day clickable before record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: false })).toBe(false);
    });

    it("disables every day after record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: true })).toBe(true);
        expect(isDayButtonDisabled({ done: false, open: true, isRecordFinalized: true })).toBe(true);
    });
});
