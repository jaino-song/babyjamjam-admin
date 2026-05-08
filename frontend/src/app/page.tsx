import type { Locale } from "@/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import LandingPage from "@/components/landing/LandingPage";

export default async function Home() {
    const locale = await getLocale();

    return <LandingPage locale={locale as Locale} />;
}
