import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
  normalizePhoneDigits,
} from "@/lib/phone";

describe("normalizePhoneDigits", () => {
  it("removes non-digit characters and limits to 11 digits", () => {
    expect(normalizePhoneDigits("032-4425-992a99")).toBe("03244259929");
  });
});

describe("normalizeKoreanPhoneLookupKey", () => {
  it("normalizes domestic and country-code mobile formats to the same key", () => {
    expect(normalizeKoreanPhoneLookupKey("01066211878")).toBe("01066211878");
    expect(normalizeKoreanPhoneLookupKey("010-6621-1878")).toBe("01066211878");
    expect(normalizeKoreanPhoneLookupKey("+82 10 6621 1878")).toBe("01066211878");
  });

  it("normalizes 82 and domestic Seoul landline formats to the same key", () => {
    expect(normalizeKoreanPhoneLookupKey("0212345678")).toBe("0212345678");
    expect(normalizeKoreanPhoneLookupKey("82 2 1234 5678")).toBe("0212345678");
    expect(normalizeKoreanPhoneLookupKey("82 02 1234 5678")).toBe("0212345678");
  });

  it("keeps overlong lookup values intact so validation can reject them", () => {
    const overlongDomestic = "010123456789";
    const overlongCountryCode = "+82 10 1234 56789";

    expect(normalizeKoreanPhoneLookupKey(overlongDomestic)).toBe(overlongDomestic);
    expect(normalizeKoreanPhoneLookupKey(overlongCountryCode)).toBe("010123456789");
    expect(isValidKoreanPhoneNumber(overlongDomestic)).toBe(false);
    expect(isValidKoreanPhoneNumber(overlongCountryCode)).toBe(false);
  });
});

describe("formatKoreanPhoneNumber", () => {
  it("formats mobile numbers with a 4-digit middle block", () => {
    expect(formatKoreanPhoneNumber("01012345678")).toBe("010-1234-5678");
    expect(formatKoreanPhoneNumber("07012345678")).toBe("070-1234-5678");
  });

  it("formats Seoul landlines with a 2-digit area code", () => {
    expect(formatKoreanPhoneNumber("0212345678")).toBe("02-1234-5678");
    expect(formatKoreanPhoneNumber("021234567")).toBe("02-123-4567");
  });

  it("formats regional landlines with a 3-digit area code", () => {
    expect(formatKoreanPhoneNumber("0324425992")).toBe("032-442-5992");
    expect(formatKoreanPhoneNumber("0311234567")).toBe("031-123-4567");
  });

  it("formats partial inputs progressively", () => {
    expect(formatKoreanPhoneNumber("0324")).toBe("032-4");
    expect(formatKoreanPhoneNumber("0324425")).toBe("032-442-5");
    expect(formatKoreanPhoneNumber("01012345")).toBe("010-1234-5");
  });
});

describe("isValidKoreanPhoneNumber", () => {
  it("accepts supported Korean phone number formats", () => {
    expect(isValidKoreanPhoneNumber("01012345678")).toBe(true);
    expect(isValidKoreanPhoneNumber("07012345678")).toBe(true);
    expect(isValidKoreanPhoneNumber("0212345678")).toBe(true);
    expect(isValidKoreanPhoneNumber("0324425992")).toBe(true);
  });

  it("rejects unsupported lengths for each prefix type", () => {
    expect(isValidKoreanPhoneNumber("03244259929")).toBe(false);
    expect(isValidKoreanPhoneNumber("02123456789")).toBe(false);
    expect(isValidKoreanPhoneNumber("0701234567")).toBe(false);
  });
});
