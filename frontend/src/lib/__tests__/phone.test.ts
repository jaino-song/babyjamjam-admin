import { formatKoreanPhoneNumber, isValidKoreanPhoneNumber, normalizePhoneDigits } from "@/lib/phone";

describe("normalizePhoneDigits", () => {
  it("removes non-digit characters and limits to 11 digits", () => {
    expect(normalizePhoneDigits("032-4425-992a99")).toBe("03244259929");
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
