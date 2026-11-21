import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { appendSafeReturnPath, getSafeServiceRecordAdminReturnPath } from "@/lib/auth/safe-return-path";
import { serverAPIClient } from "@/lib/api/server";
import { AccountCompletionForm } from "./AccountCompletionForm";

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_ACCOUNT_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";

interface PendingAccountProfile {
    email?: string;
    name?: string;
    phone?: string;
    birthDate?: string;
}

interface AccountOnboardingPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccountOnboardingPage({ searchParams }: AccountOnboardingPageProps) {
    const params = await searchParams;
    const rawReturnPath = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
    const returnPath = getSafeServiceRecordAdminReturnPath(rawReturnPath);
    // "Already signed in?" check: an unavailable backend counts as signed out.
    const currentUser = await getOptionalCurrentUser();
    if (currentUser) {
        redirect(returnPath || "/dashboard");
    }

    const cookieStore = await cookies();
    const pendingOnboardingToken = cookieStore.get(PENDING_ACCOUNT_ONBOARDING_COOKIE)?.value;

    if (!pendingOnboardingToken) {
        redirect(appendSafeReturnPath("/login", returnPath));
    }

    const response = await (async () => {
        try {
            return await serverAPIClient.get<PendingAccountProfile>("/auth/onboarding/pending", {
                headers: {
                    [PENDING_ACCOUNT_ONBOARDING_TOKEN_HEADER]: pendingOnboardingToken,
                },
            });
        } catch {
            redirect(appendSafeReturnPath("/login?authError=ONBOARDING_SESSION_EXPIRED", returnPath));
        }
    })();

    if (response.status >= 400) {
        redirect(appendSafeReturnPath("/login?authError=ONBOARDING_SESSION_EXPIRED", returnPath));
    }

    if (response.data.phone && response.data.birthDate) redirect(appendSafeReturnPath("/login", returnPath));

    return (
        <AccountCompletionForm
            email={response.data.email}
            name={response.data.name}
            phone={response.data.phone}
            birthDate={response.data.birthDate}
            returnPath={returnPath}
        />
    );
}
