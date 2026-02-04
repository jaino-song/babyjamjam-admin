import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@/app/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import { getCurrentUser } from "./lib/auth/cookies";
import { Button } from "@/components/ui/button";

export default async function Home() {
    const token = await getCurrentUser();

    // Auto redirect to dashboard if authenticated
    if (token) {
        redirect("/dashboard");
    }

    const locale = await getLocale();

    return (
        <div
            data-component="home-page"
            className="flex flex-col items-center justify-center h-screen"
        >
            <h1 className="mb-2 text-3xl font-bold text-foreground">
                {t(locale, "common.title")}
            </h1>
            <p className="mb-4 text-lg text-muted-foreground">
                {t(locale, "common.subtitle")}
            </p>
            <Button asChild>
                <Link href="/login">{t(locale, "common.start")}</Link>
            </Button>
        </div>
    );
}
