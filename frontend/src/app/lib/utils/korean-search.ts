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

/**
 * Extract initial consonant (초성) from a Korean syllable
 * Korean syllables (가-힣) are composed of: 초성 + 중성 + 종성
 * Formula: (charCode - 0xAC00) / 588 gives the 초성 index
 */
export function getChosung(char: string): string {
    const code = char.charCodeAt(0);
    // Check if it's a Korean syllable (가-힣)
    if (code >= 0xac00 && code <= 0xd7a3) {
        const chosungIndex = Math.floor((code - 0xac00) / 588);
        return CHOSUNG_LIST[chosungIndex];
    }
    // If it's already a consonant or other character, return as-is
    return char;
}

/**
 * Check if a character is a Korean initial consonant (초성)
 */
export function isChosung(char: string): boolean {
    return CHOSUNG_LIST.includes(char);
}

/**
 * Extract all initial consonants from a Korean string
 * Example: "김현아" → "ㄱㅎㅇ"
 */
export function getChosungString(str: string): string {
    return str.split("").map(getChosung).join("");
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
 * - matchesKoreanSearch("김현아", "ㅎ") → false (초성 ㅎ is not at the start)
 * - matchesKoreanSearch("테스트", "ㅅ") → false (테스트 starts with ㅌ, not ㅅ)
 */
export function matchesKoreanSearch(target: string, query: string): boolean {
    const lowerTarget = target.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Regular substring match (for full Korean characters or other text)
    if (lowerTarget.includes(lowerQuery)) {
        return true;
    }

    // Check if query contains Korean consonants for 초성 search
    const hasChosung = query.split("").some(isChosung);
    if (hasChosung) {
        const targetChosung = getChosungString(target);
        // 초성 search should match from the start of the name
        return targetChosung.startsWith(query);
    }

    return false;
}
