import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";
import { OnboardingForm } from "../kakao/onboarding/OnboardingForm";

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";

interface PendingAccountOnboardingProfile {
    email?: string;
    name?: string;
    profileImage?: string;
    phone?: string;
    birthDate?: string;
    branchId?: string;
    role?: "admin" | "manager" | "user";
}

export default async function AccountOnboardingPage() {
    const currentUser = await getCurrentUser();
    if (currentUser) {
        redirect("/dashboard");
    }

    const cookieStore = await cookies();
    const pendingOnboardingToken = cookieStore.get(PENDING_ACCOUNT_ONBOARDING_COOKIE)?.value;

    if (!pendingOnboardingToken) {
        redirect("/login");
    }

    const response = await (async () => {
        try {
            return await serverAPIClient.get<PendingAccountOnboardingProfile>("/auth/onboarding/pending", {
                headers: {
                    [PENDING_ONBOARDING_TOKEN_HEADER]: pendingOnboardingToken,
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
            phone={response.data.phone}
            birthDate={response.data.birthDate}
            branchId={response.data.branchId}
            role={response.data.role}
            mode="account"
            title="계정 정보 추가"
            subtitle="비어있는 계정 정보를 넣어주세요"
        />
    );
}
