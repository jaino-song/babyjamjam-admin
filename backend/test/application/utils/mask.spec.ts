import { maskEmail, maskPhone } from "application/utils/mask";

describe("mask utils", () => {
    describe("maskPhone", () => {
        it("should mask a hyphenated mobile number", () => {
            expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
        });

        it("should mask a digits-only mobile number", () => {
            expect(maskPhone("01012345678")).toBe("010****5678");
        });

        it("should pass through null and short strings unchanged", () => {
            expect(maskPhone(null)).toBeNull();
            expect(maskPhone(undefined)).toBeUndefined();
            expect(maskPhone("010-12")).toBe("010-12");
        });
    });

    describe("maskEmail", () => {
        it("should mask the local part of an email", () => {
            expect(maskEmail("user@host.com")).toBe("u***@host.com");
        });

        it("should pass through malformed or empty values unchanged", () => {
            expect(maskEmail("not-an-email")).toBe("not-an-email");
            expect(maskEmail("")).toBe("");
            expect(maskEmail(null)).toBeNull();
            expect(maskEmail(undefined)).toBeUndefined();
        });
    });
});
