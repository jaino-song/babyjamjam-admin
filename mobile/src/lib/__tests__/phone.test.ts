import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "../phone";

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

  it("normalizes country-code values that kept the subscriber zero", () => {
    expect(formatKoreanPhoneNumber("+82 10 0454 7742")).toBe("010-0454-7742");
    expect(formatKoreanPhoneNumber("821004547742")).toBe("010-0454-7742");
  });

  it("never renders a raw country-code prefix for a subscriber-only value", () => {
    expect(formatKoreanPhoneNumber("821-0454-7742")).toBe("010-454-7742");
  });
});
