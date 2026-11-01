import Link from "next/link";
import { t } from "@/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { Button } from "@/components/ui/button";
import { PwaDashboardRedirect } from "@/components/app/root/pwa-dashboard-redirect";

export default async function Home() {
    // "Already signed in?" check: an unavailable backend counts as signed out.
    const token = await getOptionalCurrentUser();

    // Auto redirect to dashboard if authenticated
    if (token) {
        return <PwaDashboardRedirect />;
    }

    const locale = await getLocale();

    return (
        <section
            data-component="mobile_home_page"
            className="flex flex-col items-center justify-center h-screen"
        >
            <h1 className="mb-2 text-3xl font-bold text-foreground">
                {t(locale, "common.title")}
            </h1>
            <p className="mb-4 text-lg text-muted-foreground">
                {t(locale, "common.subtitle")}
            </p>
            <Button asChild size="lg" className="min-w-[160px]">
                <Link href="/login">{t(locale, "common.start")}</Link>
            </Button>
        </section>
    );
}
