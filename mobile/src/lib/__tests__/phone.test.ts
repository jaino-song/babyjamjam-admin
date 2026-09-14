import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneDigits,
} from "../phone";

describe("phone formatting", () => {
  it("normalizes Korean mobile numbers with 82 country code", () => {
    expect(normalizeKoreanPhoneDigits("821066211878")).toBe("01066211878");
    expect(normalizeKoreanPhoneDigits("+82 10 6621 1878")).toBe("01066211878");
    expect(formatKoreanPhoneNumber("821066211878")).toBe("010-6621-1878");
    expect(formatKoreanPhoneNumber("821-0662-11878")).toBe("010-6621-1878");
  });

  it("does not leave malformed 821-prefixed values in the UI", () => {
    expect(formatKoreanPhoneNumber("821-0662-1187")).toBe("010-662-1187");
  });

  it("normalizes 82 and domestic Seoul landline formats to the same key", () => {
    expect(normalizeKoreanPhoneDigits("0212345678")).toBe("0212345678");
    expect(normalizeKoreanPhoneDigits("82 2 1234 5678")).toBe("0212345678");
    expect(normalizeKoreanPhoneDigits("82 02 1234 5678")).toBe("0212345678");
  });

  it("keeps overlong lookup values intact so validation can reject them", () => {
    const overlongDomestic = "010123456789";
    const overlongCountryCode = "+82 10 1234 56789";

    expect(normalizeKoreanPhoneDigits(overlongDomestic)).toBe(overlongDomestic);
    expect(normalizeKoreanPhoneDigits(overlongCountryCode)).toBe("010123456789");
    expect(isValidKoreanPhoneNumber(overlongDomestic)).toBe(false);
    expect(isValidKoreanPhoneNumber(overlongCountryCode)).toBe(false);
  });
});
