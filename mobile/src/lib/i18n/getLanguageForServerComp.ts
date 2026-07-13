import { cookies } from "next/headers";

export async function getLanguageForServerComp() {
  const cookieStore = await cookies();
  const language = cookieStore.get('language')?.value || 'en';
  return language;
}