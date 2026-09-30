import {
    createFieldInputState,
    resolveFieldMessage,
    withObjectParticle,
    type FieldInputState,
} from "./field-validation-message";

function state(overrides: Partial<FieldInputState> = {}): FieldInputState {
    return { ...createFieldInputState(), ...overrides };
}

describe("resolveFieldMessage: empty value", () => {
    it("shows nothing for an untouched empty field", () => {
        expect(resolveFieldMessage("text", state(), { required: true })).toBeNull();
        expect(resolveFieldMessage("phone", state())).toBeNull();
        expect(resolveFieldMessage("date", state(), { required: true })).toBeNull();
    });

    it("requires a value once the field had one", () => {
        expect(resolveFieldMessage("text", state({ hadValue: true }), { required: true }))
            .toEqual({ tone: "error", code: "required" });
    });

    it("requires a value after a submit attempt", () => {
        expect(resolveFieldMessage("text", state(), { required: true, submitted: true }))
            .toEqual({ tone: "error", code: "required" });
    });

    it("stays silent for an optional empty field even after submit", () => {
        expect(resolveFieldMessage("text", state(), { submitted: true })).toBeNull();
        expect(resolveFieldMessage("text", state({ hadValue: true }), { required: false })).toBeNull();
    });
});

describe("resolveFieldMessage: phone", () => {
    it("hints while a partial number is focused", () => {
        expect(resolveFieldMessage("phone", state({ value: "010123", focused: true })))
            .toEqual({ tone: "hint", code: "phone-format-hint" });
    });

    it("errors when a partial number was blurred", () => {
        expect(resolveFieldMessage("phone", state({ value: "010123", touched: true })))
            .toEqual({ tone: "error", code: "phone-format" });
    });

    it("errors on a partial number that is untouched but submitted", () => {
        expect(resolveFieldMessage("phone", state({ value: "010123" }), { submitted: true }))
            .toEqual({ tone: "error", code: "phone-format" });
    });

    it("hints on a partial number that is neither touched nor submitted", () => {
        expect(resolveFieldMessage("phone", state({ value: "010123" })))
            .toEqual({ tone: "hint", code: "phone-format-hint" });
    });

    it("accepts a complete mobile number with or without hyphens", () => {
        expect(resolveFieldMessage("phone", state({ value: "01012345678", touched: true }))).toBeNull();
        expect(resolveFieldMessage("phone", state({ value: "010-1234-5678", touched: true }))).toBeNull();
    });

    it("accepts a complete landline number", () => {
        expect(resolveFieldMessage("phone", state({ value: "02-123-4567", touched: true }))).toBeNull();
    });
});

describe("resolveFieldMessage: date", () => {
    it("hints while a partial date is focused and errors once blurred", () => {
        expect(resolveFieldMessage("date", state({ value: "1958-03", focused: true })))
            .toEqual({ tone: "hint", code: "date-format-hint" });
        expect(resolveFieldMessage("date", state({ value: "1958-03", touched: true })))
            .toEqual({ tone: "error", code: "date-format" });
        expect(resolveFieldMessage("date", state({ value: "1958-03" }), { submitted: true }))
            .toEqual({ tone: "error", code: "date-format" });
    });

    it("accepts a real leap day", () => {
        expect(resolveFieldMessage("date", state({ value: "2024-02-29", touched: true }))).toBeNull();
    });

    it("rejects a date that does not exist", () => {
        expect(resolveFieldMessage("date", state({ value: "2026-02-30", touched: true })))
            .toEqual({ tone: "error", code: "date-invalid" });
        expect(resolveFieldMessage("date", state({ value: "2025-02-29", touched: true })))
            .toEqual({ tone: "error", code: "date-invalid" });
    });

    it("accepts a future date", () => {
        expect(resolveFieldMessage("date", state({ value: "2027-01-15", touched: true }))).toBeNull();
    });

    it("rejects a year before 1900", () => {
        expect(resolveFieldMessage("date", state({ value: "1899-12-31", touched: true })))
            .toEqual({ tone: "error", code: "date-invalid" });
    });

    it("rejects a date before the range start", () => {
        expect(resolveFieldMessage(
            "date",
            state({ value: "2026-01-01", touched: true }),
            { dateRange: { notBefore: "2026-02-01" } },
        )).toEqual({ tone: "error", code: "date-range", params: { notBefore: "2026-02-01" } });
    });

    it("accepts a date on or after the range start", () => {
        const opts = { dateRange: { notBefore: "2026-02-01" } };
        expect(resolveFieldMessage("date", state({ value: "2026-02-01", touched: true }), opts)).toBeNull();
        expect(resolveFieldMessage("date", state({ value: "2026-03-01", touched: true }), opts)).toBeNull();
    });

    it("ignores an invalid range start", () => {
        expect(resolveFieldMessage(
            "date",
            state({ value: "2026-01-01", touched: true }),
            { dateRange: { notBefore: "2026-13-01" } },
        )).toBeNull();
    });
});

describe("resolveFieldMessage: text", () => {
    it("adds no message for a non-empty value", () => {
        expect(resolveFieldMessage("text", state({ value: "홍길동", touched: true }), { required: true })).toBeNull();
    });
});

describe("withObjectParticle", () => {
    it("uses 을 after a final consonant", () => {
        expect(withObjectParticle("이름")).toBe("이름을");
        expect(withObjectParticle("생년월일")).toBe("생년월일을");
        expect(withObjectParticle("출산 예정일")).toBe("출산 예정일을");
        expect(withObjectParticle("시작일")).toBe("시작일을");
    });

    it("uses 를 after a vowel", () => {
        expect(withObjectParticle("연락처")).toBe("연락처를");
    });

    it("handles digits and Latin letters", () => {
        expect(withObjectParticle("주소1")).toBe("주소1을");
        expect(withObjectParticle("주소2")).toBe("주소2를");
        expect(withObjectParticle("ID")).toBe("ID를");
    });

    it("returns an empty label unchanged", () => {
        expect(withObjectParticle("")).toBe("");
    });
});
