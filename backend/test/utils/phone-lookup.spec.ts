import { phoneLookupForms } from "application/utils/phone-lookup";

describe("phoneLookupForms", () => {
    it.each([
        ["01012345678", ["01012345678", "010-1234-5678"]],
        ["0111234567", ["0111234567", "011-123-4567"]],
        ["010-1234-5678", ["01012345678", "010-1234-5678"]],
        ["+82 10-1234-5678", ["01012345678", "010-1234-5678"]],
        ["legacy", ["legacy"]],
        ["", [""]],
        ["021234567", ["021234567"]],
    ])("returns distinct lookup forms for %s", (input, expected) => {
        expect(phoneLookupForms(input as string)).toEqual(expected);
    });
});
