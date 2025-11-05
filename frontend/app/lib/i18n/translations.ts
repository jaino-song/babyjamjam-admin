import enTranslations from '@/texts/en.json';
import koTranslations from '@/texts/ko.json';

export type Locale = 'ko' | 'en';

type TranslationKey = keyof typeof enTranslations;
type NestedKey<T> = T extends object ? keyof T : never;

const translations = {
  en: enTranslations,
  ko: koTranslations,
};

/**
 * Get translation by key path
 * Example: t('ko', 'dashboard.title') => "관리자 대시보드"
 */
export function t(locale: Locale, key: string): string {
  const keys = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = translations[locale];
  
  for (const k of keys) {
    value = value?.[k];
  }
  
  return value ?? key;
}

/**
 * Type-safe translation function
 * Example: tSafe('ko', 'dashboard', 'title') => "관리자 대시보드"
 */
export function tSafe<
  Category extends TranslationKey,
  Key extends NestedKey<typeof enTranslations[Category]>
>(
  locale: Locale,
  category: Category,
  key: Key
): string {
  const value = translations[locale]?.[category]?.[key as keyof typeof enTranslations[Category]];
  return String(value ?? key);
}

/**
 * Hook for client components
 */
export function useT(locale: Locale) {
  return (key: string) => t(locale, key);
}

