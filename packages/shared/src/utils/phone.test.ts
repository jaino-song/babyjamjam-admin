import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
  normalizePhoneDigits,
} from "./phone";

describe("shared Korean phone helpers", () => {
  it("keeps digit cleanup separate from lookup normalization", () => {
    expect(normalizePhoneDigits("+82 10 6621 1878")).toBe("82106621187");
    expect(normalizeKoreanPhoneLookupKey("+82 10 6621 1878")).toBe("01066211878");
    expect(normalizeKoreanPhoneLookupKey("82 2 1234 5678")).toBe("0212345678");
    expect(normalizeKoreanPhoneLookupKey("010-6621-1878")).toBe("01066211878");
  });

  it("formats Seoul, regional, mobile, and partial values consistently", () => {
    expect(formatKoreanPhoneNumber("01012345678")).toBe("010-1234-5678");
    expect(formatKoreanPhoneNumber("821066211878")).toBe("010-6621-1878");
    expect(formatKoreanPhoneNumber("821-0662-1187")).toBe("010-662-1187");
    expect(formatKoreanPhoneNumber("0212345678")).toBe("02-1234-5678");
    expect(formatKoreanPhoneNumber("021234567")).toBe("02-123-4567");
    expect(formatKoreanPhoneNumber("0324425992")).toBe("032-442-5992");
    expect(formatKoreanPhoneNumber("01012345")).toBe("010-1234-5");
  });

  it("validates supported Korean 10- and 11-digit forms", () => {
    expect(isValidKoreanPhoneNumber("01012345678")).toBe(true);
    expect(isValidKoreanPhoneNumber("+82 10 1234 5678")).toBe(true);
    expect(isValidKoreanPhoneNumber("0212345678")).toBe(true);
    expect(isValidKoreanPhoneNumber("0324425992")).toBe(true);
    expect(isValidKoreanPhoneNumber("03244259929")).toBe(false);
    expect(isValidKoreanPhoneNumber("02123456789")).toBe(false);
    expect(isValidKoreanPhoneNumber("0701234567")).toBe(false);
  });

  it("preserves overlong domestic and country-code input for validation", () => {
    expect(normalizeKoreanPhoneLookupKey("010123456789")).toBe("010123456789");
    expect(normalizeKoreanPhoneLookupKey("+82 10 1234 56789")).toBe("010123456789");
    expect(isValidKoreanPhoneNumber("010123456789")).toBe(false);
    expect(isValidKoreanPhoneNumber("+82 10 1234 56789")).toBe(false);
  });
});
