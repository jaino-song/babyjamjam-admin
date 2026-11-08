import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneDigits,
} from "../phone";

describe("phone formatting", () => {
  it("normalizes Korean mobile numbers with 82 country code", () => {
    expect(normalizeKoreanPhoneDigits("821000006621")).toBe("01000006621");
    expect(normalizeKoreanPhoneDigits("+82 10 0000 6621")).toBe("01000006621");
    expect(formatKoreanPhoneNumber("821000006621")).toBe("010-0000-6621");
    expect(formatKoreanPhoneNumber("821-0000-06621")).toBe("010-0000-6621");
  });

  it("does not leave malformed 821-prefixed values in the UI", () => {
    expect(formatKoreanPhoneNumber("821-0000-0662")).toBe("010-000-0662");
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

  it("normalizes country-code values that kept the subscriber zero", () => {
    expect(formatKoreanPhoneNumber("+82 10 0454 7742")).toBe("010-0454-7742");
    expect(formatKoreanPhoneNumber("821004547742")).toBe("010-0454-7742");
  });

  it("never renders a raw country-code prefix for a subscriber-only value", () => {
    expect(formatKoreanPhoneNumber("821-0454-7742")).toBe("010-454-7742");
  });
});
