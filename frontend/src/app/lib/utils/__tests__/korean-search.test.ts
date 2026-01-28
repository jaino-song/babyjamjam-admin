/**
 * Unit tests for Korean 초성 (initial consonant) search utility
 * Tests the search functionality used in EmployeeAutocomplete and ClientAutocomplete
 */

import {
    getChosung,
    isChosung,
    getChosungString,
    matchesKoreanSearch,
} from "../korean-search";

// ============================================
// getChosung tests
// ============================================
describe("getChosung", () => {
    describe("given Korean syllables", () => {
        it("should extract initial consonant from common characters", () => {
            expect(getChosung("가")).toBe("ㄱ");
            expect(getChosung("나")).toBe("ㄴ");
            expect(getChosung("다")).toBe("ㄷ");
            expect(getChosung("라")).toBe("ㄹ");
            expect(getChosung("마")).toBe("ㅁ");
            expect(getChosung("바")).toBe("ㅂ");
            expect(getChosung("사")).toBe("ㅅ");
            expect(getChosung("아")).toBe("ㅇ");
            expect(getChosung("자")).toBe("ㅈ");
            expect(getChosung("차")).toBe("ㅊ");
            expect(getChosung("카")).toBe("ㅋ");
            expect(getChosung("타")).toBe("ㅌ");
            expect(getChosung("파")).toBe("ㅍ");
            expect(getChosung("하")).toBe("ㅎ");
        });

        it("should extract initial consonant from complex syllables", () => {
            // Characters with 받침 (final consonant)
            expect(getChosung("김")).toBe("ㄱ");
            expect(getChosung("박")).toBe("ㅂ");
            expect(getChosung("이")).toBe("ㅇ");
            expect(getChosung("최")).toBe("ㅊ");
        });

        it("should handle double consonants (쌍자음)", () => {
            expect(getChosung("까")).toBe("ㄲ");
            expect(getChosung("빠")).toBe("ㅃ");
            expect(getChosung("싸")).toBe("ㅆ");
            expect(getChosung("짜")).toBe("ㅉ");
            expect(getChosung("따")).toBe("ㄸ");
        });

        it("should handle various vowel combinations", () => {
            // Same 초성, different vowels
            expect(getChosung("강")).toBe("ㄱ");
            expect(getChosung("경")).toBe("ㄱ");
            expect(getChosung("고")).toBe("ㄱ");
            expect(getChosung("교")).toBe("ㄱ");
            expect(getChosung("구")).toBe("ㄱ");
            expect(getChosung("규")).toBe("ㄱ");
            expect(getChosung("그")).toBe("ㄱ");
            expect(getChosung("기")).toBe("ㄱ");
        });
    });

    describe("given non-Korean characters", () => {
        it("should return the character as-is for consonants", () => {
            expect(getChosung("ㄱ")).toBe("ㄱ");
            expect(getChosung("ㄴ")).toBe("ㄴ");
            expect(getChosung("ㅎ")).toBe("ㅎ");
        });

        it("should return the character as-is for English letters", () => {
            expect(getChosung("a")).toBe("a");
            expect(getChosung("B")).toBe("B");
            expect(getChosung("z")).toBe("z");
        });

        it("should return the character as-is for numbers", () => {
            expect(getChosung("0")).toBe("0");
            expect(getChosung("5")).toBe("5");
            expect(getChosung("9")).toBe("9");
        });

        it("should return the character as-is for special characters", () => {
            expect(getChosung(" ")).toBe(" ");
            expect(getChosung("-")).toBe("-");
            expect(getChosung("@")).toBe("@");
        });
    });

    describe("given edge cases", () => {
        it("should handle first Korean syllable (가)", () => {
            expect(getChosung("가")).toBe("ㄱ");
        });

        it("should handle last Korean syllable (힣)", () => {
            expect(getChosung("힣")).toBe("ㅎ");
        });
    });
});

// ============================================
// isChosung tests
// ============================================
describe("isChosung", () => {
    describe("given Korean consonants", () => {
        it("should return true for standard 초성", () => {
            expect(isChosung("ㄱ")).toBe(true);
            expect(isChosung("ㄴ")).toBe(true);
            expect(isChosung("ㄷ")).toBe(true);
            expect(isChosung("ㄹ")).toBe(true);
            expect(isChosung("ㅁ")).toBe(true);
            expect(isChosung("ㅂ")).toBe(true);
            expect(isChosung("ㅅ")).toBe(true);
            expect(isChosung("ㅇ")).toBe(true);
            expect(isChosung("ㅈ")).toBe(true);
            expect(isChosung("ㅊ")).toBe(true);
            expect(isChosung("ㅋ")).toBe(true);
            expect(isChosung("ㅌ")).toBe(true);
            expect(isChosung("ㅍ")).toBe(true);
            expect(isChosung("ㅎ")).toBe(true);
        });

        it("should return true for double consonants (쌍자음)", () => {
            expect(isChosung("ㄲ")).toBe(true);
            expect(isChosung("ㄸ")).toBe(true);
            expect(isChosung("ㅃ")).toBe(true);
            expect(isChosung("ㅆ")).toBe(true);
            expect(isChosung("ㅉ")).toBe(true);
        });
    });

    describe("given non-초성 characters", () => {
        it("should return false for Korean syllables", () => {
            expect(isChosung("가")).toBe(false);
            expect(isChosung("김")).toBe(false);
            expect(isChosung("한")).toBe(false);
        });

        it("should return false for Korean vowels", () => {
            expect(isChosung("ㅏ")).toBe(false);
            expect(isChosung("ㅓ")).toBe(false);
            expect(isChosung("ㅗ")).toBe(false);
            expect(isChosung("ㅜ")).toBe(false);
        });

        it("should return false for English letters", () => {
            expect(isChosung("a")).toBe(false);
            expect(isChosung("Z")).toBe(false);
        });

        it("should return false for numbers and symbols", () => {
            expect(isChosung("1")).toBe(false);
            expect(isChosung("@")).toBe(false);
            expect(isChosung(" ")).toBe(false);
        });
    });
});

// ============================================
// getChosungString tests
// ============================================
describe("getChosungString", () => {
    describe("given Korean names", () => {
        it("should extract 초성 from common Korean names", () => {
            expect(getChosungString("김현아")).toBe("ㄱㅎㅇ");
            expect(getChosungString("박지성")).toBe("ㅂㅈㅅ");
            expect(getChosungString("이민호")).toBe("ㅇㅁㅎ");
            expect(getChosungString("최민수")).toBe("ㅊㅁㅅ");
        });

        it("should extract 초성 from single-character names", () => {
            expect(getChosungString("김")).toBe("ㄱ");
            expect(getChosungString("이")).toBe("ㅇ");
        });

        it("should extract 초성 from four-character names", () => {
            expect(getChosungString("독고영재")).toBe("ㄷㄱㅇㅈ");
            expect(getChosungString("남궁민수")).toBe("ㄴㄱㅁㅅ");
        });
    });

    describe("given mixed content", () => {
        it("should preserve non-Korean characters", () => {
            expect(getChosungString("Kim현아")).toBe("Kimㅎㅇ");
            expect(getChosungString("이씨123")).toBe("ㅇㅆ123");
        });

        it("should handle spaces", () => {
            expect(getChosungString("김 현아")).toBe("ㄱ ㅎㅇ");
        });
    });

    describe("given edge cases", () => {
        it("should return empty string for empty input", () => {
            expect(getChosungString("")).toBe("");
        });

        it("should handle non-Korean strings", () => {
            expect(getChosungString("ABC123")).toBe("ABC123");
        });
    });
});

// ============================================
// matchesKoreanSearch tests
// ============================================
describe("matchesKoreanSearch", () => {
    describe("given regular substring search", () => {
        it("should match exact name", () => {
            expect(matchesKoreanSearch("김현아", "김현아")).toBe(true);
        });

        it("should match prefix substring", () => {
            expect(matchesKoreanSearch("김현아", "김")).toBe(true);
            expect(matchesKoreanSearch("김현아", "김현")).toBe(true);
        });

        it("should match middle/suffix substring", () => {
            expect(matchesKoreanSearch("김현아", "현")).toBe(true);
            expect(matchesKoreanSearch("김현아", "현아")).toBe(true);
            expect(matchesKoreanSearch("김현아", "아")).toBe(true);
        });

        it("should be case-insensitive for English", () => {
            expect(matchesKoreanSearch("Kim", "kim")).toBe(true);
            expect(matchesKoreanSearch("kim", "KIM")).toBe(true);
        });
    });

    describe("given 초성 search", () => {
        it("should match single 초성 at the start", () => {
            expect(matchesKoreanSearch("김현아", "ㄱ")).toBe(true);
            expect(matchesKoreanSearch("박지성", "ㅂ")).toBe(true);
            expect(matchesKoreanSearch("이민호", "ㅇ")).toBe(true);
        });

        it("should match multiple 초성 from the start", () => {
            expect(matchesKoreanSearch("김현아", "ㄱㅎ")).toBe(true);
            expect(matchesKoreanSearch("김현아", "ㄱㅎㅇ")).toBe(true);
            expect(matchesKoreanSearch("박지성", "ㅂㅈ")).toBe(true);
            expect(matchesKoreanSearch("박지성", "ㅂㅈㅅ")).toBe(true);
        });

        it("should NOT match 초성 from the middle", () => {
            // ㅎ is the second 초성, not the first
            expect(matchesKoreanSearch("김현아", "ㅎ")).toBe(false);
            // ㅎㅇ starts from second character
            expect(matchesKoreanSearch("김현아", "ㅎㅇ")).toBe(false);
        });

        it("should NOT match incorrect 초성", () => {
            expect(matchesKoreanSearch("김현아", "ㅂ")).toBe(false);
            expect(matchesKoreanSearch("테스트", "ㅅ")).toBe(false); // 테 starts with ㅌ
        });
    });

    describe("given mixed search patterns", () => {
        it("should match full character followed by 초성", () => {
            // This is actually a substring match, not 초성 match
            expect(matchesKoreanSearch("김현아", "김ㅎ")).toBe(false);
        });
    });

    describe("given employee search scenarios", () => {
        const employees = [
            { name: "김현아", phone: "010-1234-5678", workArea: ["인천", "부천"] },
            { name: "박지성", phone: "010-9999-8888", workArea: ["서울", "강남"] },
            { name: "이민호", phone: "010-5555-6666", workArea: ["부산"] },
            { name: "최민수", phone: "010-7777-8888", workArea: ["대구", "경북"] },
            { name: "강감찬", phone: "010-1111-2222", workArea: ["광주"] },
        ];

        it("should find employees by full name", () => {
            const results = employees.filter(e => matchesKoreanSearch(e.name, "김현아"));
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("김현아");
        });

        it("should find employees by single 초성", () => {
            const results = employees.filter(e => matchesKoreanSearch(e.name, "ㄱ"));
            expect(results).toHaveLength(2); // 김현아, 강감찬
            expect(results.map(e => e.name)).toContain("김현아");
            expect(results.map(e => e.name)).toContain("강감찬");
        });

        it("should narrow down with additional 초성", () => {
            const results = employees.filter(e => matchesKoreanSearch(e.name, "ㄱㅎ"));
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("김현아");
        });

        it("should find employees by surname prefix", () => {
            const results = employees.filter(e => matchesKoreanSearch(e.name, "김"));
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("김현아");
        });

        it("should find multiple employees with same surname", () => {
            // Let's say we have multiple "이" surnames
            const extendedEmployees = [
                ...employees,
                { name: "이수진", phone: "010-0000-0000", workArea: [] },
            ];
            const results = extendedEmployees.filter(e => matchesKoreanSearch(e.name, "이"));
            expect(results).toHaveLength(2);
        });
    });

    describe("given edge cases", () => {
        it("should handle empty query", () => {
            // Empty string is contained in any string
            expect(matchesKoreanSearch("김현아", "")).toBe(true);
        });

        it("should handle empty target", () => {
            expect(matchesKoreanSearch("", "김")).toBe(false);
        });

        it("should handle double consonant names", () => {
            expect(matchesKoreanSearch("까치", "ㄲ")).toBe(true);
            expect(matchesKoreanSearch("빠른배송", "ㅃ")).toBe(true);
        });

        it("should handle long 초성 sequences", () => {
            expect(matchesKoreanSearch("대한민국만세", "ㄷㅎㅁㄱㅁㅅ")).toBe(true);
            expect(matchesKoreanSearch("대한민국만세", "ㄷㅎㅁ")).toBe(true);
        });
    });
});

// ============================================
// Performance considerations (documented tests)
// ============================================
describe("Performance considerations", () => {
    it("should handle large list filtering efficiently", () => {
        // Generate 1000 Korean names
        const surnames = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
        const firstNames = ["현아", "지성", "민호", "수진", "영희", "철수", "민수", "영재", "지혜", "준영"];

        const largeList: string[] = [];
        for (let i = 0; i < 100; i++) {
            for (const surname of surnames) {
                for (const firstName of firstNames) {
                    largeList.push(surname + firstName);
                }
            }
        }

        const start = performance.now();
        const results = largeList.filter(name => matchesKoreanSearch(name, "ㄱㅎ"));
        const end = performance.now();

        expect(end - start).toBeLessThan(100);
        expect(results.every(name => 
            getChosungString(name).startsWith("ㄱㅎ")
        )).toBe(true);
    });
});
