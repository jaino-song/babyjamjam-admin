import { phoneLookupForms } from "application/utils/phone-lookup";

describe("phoneLookupForms", () => {
    const elevenDigitForms = ["01012345678", "010-1234-5678", "010-12345678", "0101234-5678"];
    const tenDigitForms = ["0111234567", "011-123-4567", "011-1234567", "011123-4567"];

    it.each([
        ["01012345678", elevenDigitForms],
        ["0111234567", tenDigitForms],
        ["010-1234-5678", elevenDigitForms],
        ["+82 10-1234-5678", elevenDigitForms],
        ["010-12345678", elevenDigitForms],
        ["0101234-5678", elevenDigitForms],
        ["011-1234567", tenDigitForms],
        ["011123-4567", tenDigitForms],
        ["0212345678", ["0212345678", "021-234-5678"]],
        ["+1 202-555-0123", ["+1 202-555-0123"]],
        ["legacy", ["legacy"]],
        ["", [""]],
        ["021234567", ["021234567"]],
    ])("returns distinct lookup forms for %s", (input, expected) => {
        expect(phoneLookupForms(input as string)).toEqual(expected);
    });
});
