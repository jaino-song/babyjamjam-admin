import { readHeadlessOutcome } from "./headless-outcome";

// BJJ-319 5-4c: the additive headless envelope `outcome` (5-4a dispatch,
// 5-4b finalize) is only trusted when it is a registered outcome value; every
// other shape — absent on a legacy envelope, malformed, a reason token — must
// read as absent so consumers keep classifying through the legacy
// reason/fallbackHint branches.
describe("readHeadlessOutcome", () => {
    it("returns registered outcome values unchanged", () => {
        expect(readHeadlessOutcome("NOT_APPLIED")).toBe("NOT_APPLIED");
        expect(readHeadlessOutcome("FAILED")).toBe("FAILED");
        expect(readHeadlessOutcome("PARTIALLY_APPLIED")).toBe("PARTIALLY_APPLIED");
        expect(readHeadlessOutcome("UNKNOWN")).toBe("UNKNOWN");
    });

    it("treats absent, malformed, and unregistered values as absent", () => {
        expect(readHeadlessOutcome(undefined)).toBeNull();
        expect(readHeadlessOutcome(null)).toBeNull();
        // A legacy reason token is not an outcome and must not be promoted.
        expect(readHeadlessOutcome("remote_unconfirmed")).toBeNull();
        expect(readHeadlessOutcome("")).toBeNull();
        expect(readHeadlessOutcome(42)).toBeNull();
        expect(readHeadlessOutcome({ outcome: "UNKNOWN" })).toBeNull();
    });
});
