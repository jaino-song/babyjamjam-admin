import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import LandingPage from "@/components/landing/LandingPage";

export default async function Home() {
    const cookieStore = await cookies();
    if (cookieStore.get("auth_token")) {
        redirect("/dashboard");
    }

    const locale = await getLocale();
    return <LandingPage locale={locale as Locale} />;
}
