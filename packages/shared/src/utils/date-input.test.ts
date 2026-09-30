import { formatIsoDateInput } from "./date-input";

describe("formatIsoDateInput", () => {
    it("inserts hyphens after the year and month", () => {
        expect(formatIsoDateInput("19580303")).toBe("1958-03-03");
    });

    it("keeps partial input partial", () => {
        expect(formatIsoDateInput("1958")).toBe("1958");
        expect(formatIsoDateInput("195803")).toBe("1958-03");
        expect(formatIsoDateInput("1958030")).toBe("1958-03-0");
        expect(formatIsoDateInput("")).toBe("");
    });

    it("strips non-digits and caps at eight digits", () => {
        expect(formatIsoDateInput("1958-03-03x9")).toBe("1958-03-03");
        expect(formatIsoDateInput("abc")).toBe("");
    });
});
