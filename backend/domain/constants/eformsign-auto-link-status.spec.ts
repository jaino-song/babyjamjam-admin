import {
    AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES,
    EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES,
    isEformsignAutoLinkEligibleStatus,
} from "./eformsign-auto-link-status";

describe("eformsign auto-link status eligibility (계약-05)", () => {
    it.each([...AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES])(
        "accepts %s from the auto-registration set",
        (code) => {
            expect(isEformsignAutoLinkEligibleStatus(code)).toBe(true);
        },
    );

    it.each(["040", "045", "071"])(
        "accepts the live contract status %s for linking to an existing client",
        (code) => {
            expect(isEformsignAutoLinkEligibleStatus(code)).toBe(true);
        },
    );

    it.each(["001", "011", "042", "080", "099", "047", null, undefined, ""])(
        "refuses %s",
        (code) => {
            expect(isEformsignAutoLinkEligibleStatus(code as never)).toBe(false);
        },
    );

    it("keeps the new-client set unchanged and free of 040, 045 and 071", () => {
        expect([...AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES].sort()).toEqual([
            "002", "003", "010", "012", "020", "022", "030", "032", "041",
            "043", "050", "060", "062", "063", "064", "070", "072", "092",
        ]);
        for (const code of ["040", "045", "071"]) {
            expect(AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES.has(code)).toBe(false);
            expect(EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES.has(code)).toBe(true);
        }
    });
});
