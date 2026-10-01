export type PhoneInput = string | number | null | undefined;
/** Strip presentation characters without changing the persisted value. */
export declare function normalizePhoneDigits(value: PhoneInput, maxLength?: number): string;
/**
 * Canonical lookup-only key for Korean numbers.
 *
 * This key is deliberately separate from the value stored/displayed by a
 * caller: it is only for matching records that use different formatting or
 * the +82 / 0082 country-code representation.
 */
export declare function normalizeKoreanPhoneLookupKey(value: PhoneInput): string;
export declare const normalizeKoreanPhoneForLookup: typeof normalizeKoreanPhoneLookupKey;
export declare const normalizeKoreanPhoneDigits: typeof normalizeKoreanPhoneLookupKey;
export declare function isValidKoreanPhoneNumber(value: PhoneInput): boolean;
export declare function formatKoreanPhoneNumber(value: PhoneInput): string;
