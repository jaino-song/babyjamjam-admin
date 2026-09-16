import { redirect } from "next/navigation";
import { appendSafeReturnPath, getSafeServiceRecordAdminReturnPath } from "@/lib/auth/safe-return-path";

interface AccountOnboardingPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccountOnboardingPage({ searchParams }: AccountOnboardingPageProps) {
    const params = await searchParams;
    const rawReturnPath = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
    const returnPath = getSafeServiceRecordAdminReturnPath(rawReturnPath);

    redirect(appendSafeReturnPath("/login?authError=ACCOUNT_PROFILE_INCOMPLETE", returnPath));
}
