import { getConsultationPhoneSearchVariants } from "infrastructure/database/repositories/sb.consultation-inquiry.repository";

describe("getConsultationPhoneSearchVariants", () => {
    it("should include hyphenated and digit-only variants for mobile numbers", () => {
        expect(getConsultationPhoneSearchVariants("010-9641-1878")).toEqual([
            "010-9641-1878",
            "01096411878",
            "010-96411878",
            "0109641-1878",
        ]);
    });

    it("should preserve exact trimmed value for unsupported formats", () => {
        expect(getConsultationPhoneSearchVariants(" 1661-2386 ")).toEqual(["1661-2386"]);
    });
});
