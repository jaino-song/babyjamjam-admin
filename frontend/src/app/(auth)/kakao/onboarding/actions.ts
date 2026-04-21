"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface CompleteKakaoOnboardingInput {
    phone: string;
    birthDate: string;
    organizationId: string;
    role: string;
}

interface CompleteKakaoOnboardingSuccessResponse {
    accessToken: string;
    refreshToken: string;
    requiresOrgSelection?: boolean;
}

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_KAKAO_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";

export async function completeKakaoOnboarding(
    input: CompleteKakaoOnboardingInput,
): Promise<{ success: boolean; error?: string; requiresOrgSelection?: boolean }> {
    const cookieStore = await cookies();
    const pendingSignupToken = cookieStore.get(PENDING_KAKAO_SIGNUP_COOKIE)?.value;

    if (!pendingSignupToken) {
        return {
            success: false,
            error: "카카오 가입 세션이 만료되었습니다. 다시 로그인해 주세요.",
        };
    }

    try {
        const response = await serverAPIClient.post<CompleteKakaoOnboardingSuccessResponse>(
            "/auth/kakao/complete-signup",
            input,
            {
                headers: {
                    [PENDING_KAKAO_SIGNUP_TOKEN_HEADER]: pendingSignupToken,
                },
            },
        );

        if (response.status >= 400) {
            if (response.status === 401) {
                cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
            }

            const message = typeof response.data === "object" && response.data && "message" in response.data
                ? String(response.data.message)
                : "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";

            return {
                success: false,
                error: message,
            };
        }

        setAuthSessionCookies(cookieStore, {
            accessToken: response.data.accessToken,
            refreshToken: response.data.refreshToken,
        });

        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);

        return {
            success: true,
            requiresOrgSelection: response.data.requiresOrgSelection || false,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            const message = error.response?.data?.message || "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";
            return { success: false, error: message };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
