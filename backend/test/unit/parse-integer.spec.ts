import { BadRequestException } from "@nestjs/common";
import { parseInteger, parseOptionalInteger } from "interface/parse-integer";

function catchOf(exec: () => unknown): unknown {
    try {
        exec();
    } catch (error) {
        return error;
    }
    throw new Error("expected the call to reject");
}

// The HTTP mapper keys on the body code, so a raw English string would fall
// back to the legacy envelope instead of the problem contract. Every parser
// rejection must therefore be a registered VALIDATION_FAILED problem (400).
function expectValidationProblem(
    exec: () => unknown,
    expectedError: { pointer: string; code: string; detail: string },
): void {
    const thrown = catchOf(exec);
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getStatus()).toBe(400);
    expect((thrown as BadRequestException).getResponse()).toMatchObject({
        code: "VALIDATION_FAILED",
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        errors: [expectedError],
    });
}

describe("parseInteger", () => {
    it("should parse safe integer strings", () => {
        expect(parseInteger("12", "limit")).toBe(12);
    });

    it("should use a default value when input is missing", () => {
        expect(parseInteger(undefined, "limit", { defaultValue: 20 })).toBe(20);
    });

    it.each(["abc", "1.5", "Infinity", "NaN", ""])(
        "should reject invalid integer input %s",
        (value) => {
            expectValidationProblem(() => parseInteger(value, "id"), {
                pointer: "/id",
                code: "INVALID_FORMAT",
                detail: "id 값이 올바르지 않아요.",
            });
        },
    );

    it("should reject a missing value without a default as an INVALID_FORMAT problem", () => {
        expectValidationProblem(() => parseInteger(undefined, "id"), {
            pointer: "/id",
            code: "INVALID_FORMAT",
            detail: "id 값이 올바르지 않아요.",
        });
    });

    it("should reject values below the minimum", () => {
        expectValidationProblem(() => parseInteger("0", "id", { min: 1 }), {
            pointer: "/id",
            code: "OUT_OF_RANGE",
            detail: "id 값은 1 이상이어야 해요.",
        });
    });

    it("should reject values above the maximum", () => {
        expectValidationProblem(() => parseInteger("101", "limit", { max: 100 }), {
            pointer: "/limit",
            code: "OUT_OF_RANGE",
            detail: "limit 값은 100 이하여야 해요.",
        });
    });
});

describe("parseOptionalInteger", () => {
    it("should return undefined for missing values", () => {
        expect(parseOptionalInteger(undefined, "year")).toBeUndefined();
    });

    it("should parse present optional values", () => {
        expect(parseOptionalInteger("2026", "year", { min: 1900, max: 2200 })).toBe(2026);
    });

    it("should inherit the problem-contract rejections through parseInteger", () => {
        expectValidationProblem(() => parseOptionalInteger("1800", "year", { min: 1900 }), {
            pointer: "/year",
            code: "OUT_OF_RANGE",
            detail: "year 값은 1900 이상이어야 해요.",
        });
    });
});
