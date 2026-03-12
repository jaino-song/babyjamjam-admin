/**
 * Korean initial consonant (초성) search utility
 *
 * Enables searching Korean names by typing just the initial consonants.
 * Examples:
 * - 김현아 → ㄱㅎㅇ
 * - 박지성 → ㅂㅈㅅ
 * - ㄱ → matches 김, 강, 곽, etc.
 */

// Korean initial consonants (초성) in Unicode order
const CHOSUNG_LIST = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

const CHOSUNG_SET = new Set(CHOSUNG_LIST);
const chosungStringCache = new Map<string, string>();
const searchTargetCache = new Map<string, { lowerTarget: string; chosung: string }>();
const queryHasChosungCache = new Map<string, boolean>();

/**
 * Extract initial consonant (초성) from a Korean syllable
 * Korean syllables (가-힣) are composed of: 초성 + 중성 + 종성
 * Formula: (charCode - 0xAC00) / 588 gives the 초성 index
 */
export function getChosung(char: string): string {
    const code = char.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
        const chosungIndex = Math.floor((code - 0xac00) / 588);
        return CHOSUNG_LIST[chosungIndex];
    }
    return char;
}

/**
 * Check if a character is a Korean initial consonant (초성)
 */
export function isChosung(char: string): boolean {
    return CHOSUNG_SET.has(char);
}

/**
 * Extract all initial consonants from a Korean string
 * Example: "김현아" → "ㄱㅎㅇ"
 */
export function getChosungString(str: string): string {
    const cached = chosungStringCache.get(str);
    if (cached) return cached;

    let result = "";
    for (const char of str) {
        result += getChosung(char);
    }

    chosungStringCache.set(str, result);
    return result;
}

/**
 * Check if search query matches the target string
 * Supports both regular substring matching and 초성 search
 *
 * @param target - The string to search in (e.g., person's name)
 * @param query - The search query (can be regular text or 초성)
 * @returns true if the query matches the target
 *
 * Examples:
 * - matchesKoreanSearch("김현아", "김") → true (regular match, starts with)
 * - matchesKoreanSearch("김현아", "현") → true (regular match, contains)
 * - matchesKoreanSearch("김현아", "ㄱ") → true (초성 match, starts with ㄱ)
 * - matchesKoreanSearch("김현아", "ㄱㅎ") → true (초성 match, starts with ㄱㅎ)
 * - matchesKoreanSearch("김현아", "ㄱㅎㅇ") → true (초성 match)
 * - matchesKoreanSearch("김현아", "ㅎ") → false (초성 ㅎ is not at the start; full chosung is ㄱㅎㅇ)
 * - matchesKoreanSearch("테스트", "ㅅ") → false (starts with ㅌ, not ㅅ)
 * - matchesKoreanSearch("테스트 신규", "ㅅ") → false (full chosung ㅌㅅㅌㅅㄱ starts with ㅌ)
 */
export function matchesKoreanSearch(target: string, query: string): boolean {
    const lowerQuery = query.toLowerCase();

    let cachedTarget = searchTargetCache.get(target);
    if (!cachedTarget) {
        const normalizedTarget = target.normalize("NFC");
        cachedTarget = {
            lowerTarget: normalizedTarget.toLowerCase(),
            chosung: getChosungString(normalizedTarget).replace(/\s/g, ""),
        };
        searchTargetCache.set(target, cachedTarget);
    }

    if (cachedTarget.lowerTarget.includes(lowerQuery)) {
        return true;
    }

    let hasChosung = queryHasChosungCache.get(query);
    if (hasChosung === undefined) {
        hasChosung = false;
        for (const char of query) {
            if (isChosung(char)) {
                hasChosung = true;
                break;
            }
        }
        queryHasChosungCache.set(query, hasChosung);
    }

    if (hasChosung) {
        return cachedTarget.chosung.startsWith(query);
    }

    return false;
}
