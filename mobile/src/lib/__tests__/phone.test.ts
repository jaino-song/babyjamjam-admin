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
});
