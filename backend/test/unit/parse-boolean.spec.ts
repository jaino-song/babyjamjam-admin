import { BadRequestException } from "@nestjs/common";
import { parseBooleanQuery } from "interface/parse-boolean";

function catchOf(exec: () => unknown): unknown {
    try {
        exec();
    } catch (error) {
        return error;
    }
    throw new Error("expected the call to reject");
}

describe("parseBooleanQuery", () => {
    it("should return the default when the value is missing", () => {
        expect(parseBooleanQuery(undefined, "excludeDeleted", false)).toBe(false);
        expect(parseBooleanQuery("", "excludeDeleted", true)).toBe(true);
    });

    it("should parse true and false", () => {
        expect(parseBooleanQuery("true", "excludeDeleted", false)).toBe(true);
        expect(parseBooleanQuery("false", "excludeDeleted", false)).toBe(false);
    });

    // The HTTP mapper keys on the body code, so the rejection must be a
    // registered VALIDATION_FAILED problem (400), not a raw English string.
    it("should reject any other value as an INVALID_FORMAT field error", () => {
        const thrown = catchOf(() => parseBooleanQuery("yes", "excludeDeleted", false));
        expect(thrown).toBeInstanceOf(BadRequestException);
        expect((thrown as BadRequestException).getStatus()).toBe(400);
        expect((thrown as BadRequestException).getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            errors: [{
                pointer: "/excludeDeleted",
                code: "INVALID_FORMAT",
                detail: "true 또는 false여야 해요.",
            }],
        });
    });
});
