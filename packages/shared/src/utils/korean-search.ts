import { normalizeKoreanPhoneLookupKey } from "./phone";

const CHOSUNG_LIST = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
  "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const CHOSUNG_SET = new Set<string>(CHOSUNG_LIST);

export function getChosung(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return CHOSUNG_LIST[Math.floor((code - 0xac00) / 588)] ?? char;
  }
  return char;
}

export function isChosung(char: string): boolean {
  return CHOSUNG_SET.has(char);
}

export function getChosungString(value: string): string {
  return Array.from(value.normalize("NFC"), getChosung).join("");
}

export function matchesKoreanSearch(target: string, query: string): boolean {
  const normalizedTarget = target.normalize("NFC").toLowerCase();
  const normalizedQuery = query.normalize("NFC").trim().toLowerCase();

  if (normalizedTarget.includes(normalizedQuery)) return true;

  if (!Array.from(normalizedQuery).some(isChosung)) return false;

  const targetChosung = getChosungString(normalizedTarget).replace(/\s/g, "");
  return targetChosung.startsWith(normalizedQuery);
}

export type SearchableValue = string | number | null | undefined;

const PHONE_LIKE_QUERY_PATTERN = /^\+?[\d\s().-]*\d[\d\s().-]*$/;

/** Return true only when a search query is made exclusively of phone syntax. */
export function isPhoneLikeSearchQuery(query: string): boolean {
  return PHONE_LIKE_QUERY_PATTERN.test(query.trim());
}

/**
 * Match a query against multiple text fields. Phone-like queries also compare
 * lookup-only Korean phone keys so formatting and +82 do not matter.
 */
export function matchesSearchQuery(
  query: string,
  values: readonly SearchableValue[],
): boolean {
  const normalizedQuery = query.normalize("NFC").trim();
  if (!normalizedQuery) return true;

  const phoneQuery = isPhoneLikeSearchQuery(normalizedQuery)
    ? normalizeKoreanPhoneLookupKey(normalizedQuery)
    : "";

  return values.some((value) => {
    if (value == null) return false;

    const target = String(value);
    if (matchesKoreanSearch(target, normalizedQuery)) return true;
    if (!phoneQuery) return false;

    return normalizeKoreanPhoneLookupKey(target).includes(phoneQuery);
  });
}

export const matchesSearchValues = matchesSearchQuery;
