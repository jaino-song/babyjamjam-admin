'use server'
import { cookies } from 'next/headers';

import { getServerRuntimeConfig } from "@/lib/env";

export type Locale = 'ko' | 'en';

export async function setLocale(locale: Locale) {
  const cookieStore = await cookies();
  
  cookieStore.set('NEXT_LOCALE', locale, {
    httpOnly: true,
    secure: getServerRuntimeConfig().isProductionNodeEnv,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60, // 1 year in seconds
  });
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value;
  return (locale as Locale) ?? 'ko';
}
