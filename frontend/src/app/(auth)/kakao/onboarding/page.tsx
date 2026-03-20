import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";
import { OnboardingForm } from "./OnboardingForm";

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_KAKAO_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";

interface PendingKakaoSignupProfile {
    email?: string;
    name?: string;
    profileImage?: string;
}

export default async function KakaoOnboardingPage() {
    const currentUser = await getCurrentUser();
    if (currentUser) {
        redirect("/dashboard");
    }

    const cookieStore = await cookies();
    const pendingSignupToken = cookieStore.get(PENDING_KAKAO_SIGNUP_COOKIE)?.value;

    if (!pendingSignupToken) {
        redirect("/login");
    }

    const response = await (async () => {
        try {
            return await serverAPIClient.get<PendingKakaoSignupProfile>("/auth/kakao/pending-signup", {
                headers: {
                    [PENDING_KAKAO_SIGNUP_TOKEN_HEADER]: pendingSignupToken,
                },
            });
        } catch {
            redirect("/login");
        }
    })();

    if (response.status >= 400) {
        redirect("/login");
    }

    return (
        <OnboardingForm
            email={response.data.email}
            name={response.data.name}
            profileImage={response.data.profileImage}
        />
    );
}
