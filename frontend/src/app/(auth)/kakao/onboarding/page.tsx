import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/cookies";
import { appendSafeReturnPath, getSafeServiceRecordAdminReturnPath } from "@/lib/auth/safe-return-path";
import { serverAPIClient } from "@/lib/api/server";
import { OnboardingForm } from "./OnboardingForm";

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_KAKAO_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";

interface PendingKakaoSignupProfile {
    email?: string;
    name?: string;
    profileImage?: string;
}

interface KakaoOnboardingPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function KakaoOnboardingPage({ searchParams }: KakaoOnboardingPageProps) {
    const params = await searchParams;
    const rawReturnPath = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
    const returnPath = getSafeServiceRecordAdminReturnPath(rawReturnPath);
    const currentUser = await getCurrentUser();
    if (currentUser) {
        redirect(returnPath || "/dashboard");
    }

    const cookieStore = await cookies();
    const pendingSignupToken = cookieStore.get(PENDING_KAKAO_SIGNUP_COOKIE)?.value;

    if (!pendingSignupToken) {
        redirect(appendSafeReturnPath("/login", returnPath));
    }

    const response = await (async () => {
        try {
            return await serverAPIClient.get<PendingKakaoSignupProfile>("/auth/kakao/pending-signup", {
                headers: {
                    [PENDING_KAKAO_SIGNUP_TOKEN_HEADER]: pendingSignupToken,
                },
            });
        } catch {
            redirect(appendSafeReturnPath("/login", returnPath));
        }
    })();

    if (response.status >= 400) {
        redirect(appendSafeReturnPath("/login", returnPath));
    }

    return (
        <OnboardingForm
            email={response.data.email}
            name={response.data.name}
            profileImage={response.data.profileImage}
            returnPath={returnPath}
        />
    );
}
