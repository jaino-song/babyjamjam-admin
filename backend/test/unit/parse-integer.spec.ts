import { BadRequestException } from "@nestjs/common";
import { parseInteger, parseOptionalInteger } from "interface/parse-integer";

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
            expect(() => parseInteger(value, "id")).toThrow(BadRequestException);
        },
    );

    it("should reject values below the minimum", () => {
        expect(() => parseInteger("0", "id", { min: 1 })).toThrow(BadRequestException);
    });

    it("should reject values above the maximum", () => {
        expect(() => parseInteger("101", "limit", { max: 100 })).toThrow(BadRequestException);
    });
});

describe("parseOptionalInteger", () => {
    it("should return undefined for missing values", () => {
        expect(parseOptionalInteger(undefined, "year")).toBeUndefined();
    });

    it("should parse present optional values", () => {
        expect(parseOptionalInteger("2026", "year", { min: 1900, max: 2200 })).toBe(2026);
    });
});
