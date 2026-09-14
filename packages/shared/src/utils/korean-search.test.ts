import {
  getChosung,
  getChosungString,
  isChosung,
  isPhoneLikeSearchQuery,
  matchesKoreanSearch,
  matchesSearchQuery,
} from "./korean-search";

describe("shared Korean search", () => {
  it("extracts and recognizes Korean initials", () => {
    expect(getChosung("김")).toBe("ㄱ");
    expect(getChosungString("김현아")).toBe("ㄱㅎㅇ");
    expect(isChosung("ㄲ")).toBe(true);
    expect(isChosung("가")).toBe(false);
  });

  it("matches NFC/case-insensitive text and initial-consonant prefixes", () => {
    expect(matchesKoreanSearch("김현아", "현아")).toBe(true);
    expect(matchesKoreanSearch("Kim", "kim")).toBe(true);
    expect(matchesKoreanSearch("김현아", "ㄱㅎ")).toBe(true);
    expect(matchesKoreanSearch("김현아", "ㅎ")).toBe(false);
    expect(matchesKoreanSearch("김현아", "김")).toBe(true);
  });

  it("matches any text field and formatted phone values", () => {
    const fields = ["송진호", "010-6621-1878", "인천광역시 연수구"];

    expect(matchesSearchQuery("ㅅㅈㅎ", fields)).toBe(true);
    expect(matchesSearchQuery("연수구", fields)).toBe(true);
    expect(matchesSearchQuery("0106621", fields)).toBe(true);
    expect(matchesSearchQuery("+82 10 6621", fields)).toBe(true);
    expect(matchesSearchQuery("없는 값", fields)).toBe(false);
    expect(matchesSearchQuery("   ", fields)).toBe(true);
  });

  it("only performs phone matching for explicitly phone-like queries", () => {
    const fields = ["송진호", "010-6621-1878"];

    expect(isPhoneLikeSearchQuery("010-6621")).toBe(true);
    expect(isPhoneLikeSearchQuery("+82 10 6621")).toBe(true);
    expect(isPhoneLikeSearchQuery("고객0106621")).toBe(false);
    expect(isPhoneLikeSearchQuery("0106621abc")).toBe(false);
    expect(matchesSearchQuery("고객0106621", fields)).toBe(false);
    expect(matchesSearchQuery("010-6621", fields)).toBe(true);
  });
});
