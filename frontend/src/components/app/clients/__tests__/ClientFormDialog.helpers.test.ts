/**
 * Unit tests for ClientFormDialog helper functions
 * Tests price formatting, phone number formatting, and date formatting utilities
 */

// Helper function implementations (extracted from ClientFormDialog for testing)
const formatPrice = (price: number | string): string => {
    if (!price && price !== 0) return "";
    const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "";
    return num.toLocaleString("ko-KR");
};

const parsePrice = (value: string | null | undefined): string => {
    if (!value) return "";
    return value.replace(/,/g, "");
};

const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) {
        return digits;
    } else if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
    }
};

const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

// ============================================
// formatPrice tests
// ============================================
describe("formatPrice", () => {
    describe("given valid number inputs", () => {
        it("should format integer with Korean locale commas", () => {
            expect(formatPrice(1000)).toBe("1,000");
            expect(formatPrice(1000000)).toBe("1,000,000");
            expect(formatPrice(123456789)).toBe("123,456,789");
        });

        it("should handle zero correctly", () => {
            expect(formatPrice(0)).toBe("0");
        });

        it("should handle small numbers without commas", () => {
            expect(formatPrice(1)).toBe("1");
            expect(formatPrice(99)).toBe("99");
            expect(formatPrice(999)).toBe("999");
        });
    });

    describe("given string inputs", () => {
        it("should format string numbers correctly", () => {
            expect(formatPrice("1000")).toBe("1,000");
            expect(formatPrice("1000000")).toBe("1,000,000");
        });

        it("should handle strings already containing commas", () => {
            expect(formatPrice("1,000")).toBe("1,000");
            expect(formatPrice("1,000,000")).toBe("1,000,000");
        });

        it("should handle mixed comma formatting", () => {
            expect(formatPrice("10,00")).toBe("1,000"); // Incorrectly formatted input
            expect(formatPrice("1,00,000")).toBe("100,000");
        });
    });

    describe("given invalid inputs", () => {
        it("should return empty string for empty/null/undefined", () => {
            expect(formatPrice("")).toBe("");
            // @ts-expect-error - testing edge case
            expect(formatPrice(null)).toBe("");
            // @ts-expect-error - testing edge case
            expect(formatPrice(undefined)).toBe("");
        });

        it("should return empty string for non-numeric strings", () => {
            expect(formatPrice("abc")).toBe("");
            expect(formatPrice("not a number")).toBe("");
            expect(formatPrice("!@#$")).toBe("");
        });

        it("should parse partial numeric strings", () => {
            expect(formatPrice("123abc")).toBe("123");
            expect(formatPrice("abc123")).toBe(""); // parseInt returns NaN for leading non-digits
        });
    });
});

// ============================================
// parsePrice tests
// ============================================
describe("parsePrice", () => {
    describe("given formatted price strings", () => {
        it("should remove all commas", () => {
            expect(parsePrice("1,000")).toBe("1000");
            expect(parsePrice("1,000,000")).toBe("1000000");
            expect(parsePrice("123,456,789")).toBe("123456789");
        });

        it("should handle strings without commas", () => {
            expect(parsePrice("1000")).toBe("1000");
            expect(parsePrice("0")).toBe("0");
        });
    });

    describe("given invalid inputs", () => {
        it("should return empty string for null/undefined/empty", () => {
            expect(parsePrice(null)).toBe("");
            expect(parsePrice(undefined)).toBe("");
            expect(parsePrice("")).toBe("");
        });
    });

    describe("given edge cases", () => {
        it("should handle multiple consecutive commas", () => {
            expect(parsePrice("1,,000")).toBe("1000");
        });

        it("should only remove commas, not other characters", () => {
            expect(parsePrice("1,000원")).toBe("1000원");
        });
    });
});

// ============================================
// formatPhoneNumber tests
// ============================================
describe("formatPhoneNumber", () => {
    describe("given Korean phone number inputs", () => {
        it("should format full 11-digit phone numbers (010-XXXX-XXXX)", () => {
            expect(formatPhoneNumber("01012345678")).toBe("010-1234-5678");
            expect(formatPhoneNumber("01099998888")).toBe("010-9999-8888");
        });

        it("should format partial numbers progressively", () => {
            expect(formatPhoneNumber("0")).toBe("0");
            expect(formatPhoneNumber("01")).toBe("01");
            expect(formatPhoneNumber("010")).toBe("010");
            expect(formatPhoneNumber("0101")).toBe("010-1");
            expect(formatPhoneNumber("01012")).toBe("010-12");
            expect(formatPhoneNumber("010123")).toBe("010-123");
            expect(formatPhoneNumber("0101234")).toBe("010-1234");
            expect(formatPhoneNumber("01012345")).toBe("010-1234-5");
            expect(formatPhoneNumber("010123456")).toBe("010-1234-56");
            expect(formatPhoneNumber("0101234567")).toBe("010-1234-567");
        });
    });

    describe("given already formatted inputs", () => {
        it("should handle inputs with existing dashes", () => {
            expect(formatPhoneNumber("010-1234-5678")).toBe("010-1234-5678");
            expect(formatPhoneNumber("010-123-4567")).toBe("010-1234-567"); // Re-formats
        });

        it("should strip non-digit characters before formatting", () => {
            expect(formatPhoneNumber("(010) 1234-5678")).toBe("010-1234-5678");
            expect(formatPhoneNumber("010.1234.5678")).toBe("010-1234-5678");
            expect(formatPhoneNumber("010 1234 5678")).toBe("010-1234-5678");
        });
    });

    describe("given truncation requirements", () => {
        it("should truncate numbers longer than 11 digits", () => {
            expect(formatPhoneNumber("010123456789")).toBe("010-1234-5678"); // Last digit ignored
            expect(formatPhoneNumber("01012345678999")).toBe("010-1234-5678");
        });
    });

    describe("given empty or invalid inputs", () => {
        it("should handle empty input", () => {
            expect(formatPhoneNumber("")).toBe("");
        });

        it("should filter out non-digit characters", () => {
            expect(formatPhoneNumber("abc")).toBe("");
            expect(formatPhoneNumber("!@#")).toBe("");
        });
    });
});

// ============================================
// formatDateForInput tests
// ============================================
describe("formatDateForInput", () => {
    describe("given ISO date strings", () => {
        it("should convert ISO string to yyyy-MM-dd format", () => {
            expect(formatDateForInput("2025-12-26T00:00:00.000Z")).toBe("2025-12-26");
            expect(formatDateForInput("2024-01-15T12:30:45.123Z")).toBe("2024-01-15");
        });

        it("should handle ISO strings with different timezones", () => {
            // Note: This might vary based on local timezone
            const result = formatDateForInput("2025-06-15T23:59:59.999Z");
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe("given simple date strings", () => {
        it("should parse date-only strings", () => {
            expect(formatDateForInput("2025-12-26")).toBe("2025-12-26");
            expect(formatDateForInput("2024-01-01")).toBe("2024-01-01");
        });
    });

    describe("given invalid inputs", () => {
        it("should return empty string for null/undefined/empty", () => {
            expect(formatDateForInput(null)).toBe("");
            expect(formatDateForInput(undefined)).toBe("");
            expect(formatDateForInput("")).toBe("");
        });

        it("should return empty string for invalid date strings", () => {
            expect(formatDateForInput("not-a-date")).toBe("");
            expect(formatDateForInput("2025-99-99")).toBe(""); // Invalid month/day
            expect(formatDateForInput("abc123")).toBe("");
        });
    });

    describe("given edge cases", () => {
        it("should handle leap year dates", () => {
            expect(formatDateForInput("2024-02-29T00:00:00.000Z")).toBe("2024-02-29");
        });

        it("should handle end of month dates", () => {
            expect(formatDateForInput("2025-01-31T00:00:00.000Z")).toBe("2025-01-31");
            expect(formatDateForInput("2025-04-30T00:00:00.000Z")).toBe("2025-04-30");
        });
    });
});

// ============================================
// Integration-like tests for form data flow
// ============================================
describe("Form data flow integration", () => {
    describe("price formatting round-trip", () => {
        it("should format and parse prices consistently", () => {
            const original = "1500000";
            const formatted = formatPrice(original);
            expect(formatted).toBe("1,500,000");
            const parsed = parsePrice(formatted);
            expect(parsed).toBe(original);
        });

        it("should handle user input with commas correctly", () => {
            // User types "1,500,000" in the field
            const userInput = "1,500,000";
            // System stores without commas
            const stored = parsePrice(userInput);
            expect(stored).toBe("1500000");
            // System displays with commas
            const displayed = formatPrice(stored);
            expect(displayed).toBe("1,500,000");
        });
    });

    describe("phone number formatting round-trip", () => {
        it("should maintain digits through formatting", () => {
            const rawDigits = "01012345678";
            const formatted = formatPhoneNumber(rawDigits);
            expect(formatted).toBe("010-1234-5678");
            // Digits can be extracted by removing dashes
            const extracted = formatted.replace(/-/g, "");
            expect(extracted).toBe(rawDigits);
        });
    });
});
