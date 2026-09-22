"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { normalizeApiError } from "@babyjamjam/shared";

interface CompleteKakaoOnboardingInput {
    phone: string;
    birthDate: string;
    role: string;
}

interface CompleteKakaoOnboardingSuccessResponse {
    success: boolean;
    message?: string;
}

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_KAKAO_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";

// Locally authored failure copy — upstream body messages and Error.message
// internals are never forwarded to the client flow.
const KAKAO_SIGNUP_FAILURE_COPY = "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";

function kakaoSignupFailure(status: number, data: unknown): string {
    const normalized = normalizeApiError(
        { response: { status, data } },
        { locale: "ko-KR", operation: "mutation" },
    );
    return normalized.verified ? normalized.message : KAKAO_SIGNUP_FAILURE_COPY;
}

export async function completeKakaoOnboarding(
    input: CompleteKakaoOnboardingInput,
): Promise<{ success: boolean; error?: string }> {
    const cookieStore = await cookies();
    const pendingSignupToken = cookieStore.get(PENDING_KAKAO_SIGNUP_COOKIE)?.value;

    if (!pendingSignupToken) {
        return {
            success: false,
            error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요.",
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

            return {
                success: false,
                error: kakaoSignupFailure(response.status, response.data),
            };
        }

        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);

        return {
            success: true,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            return {
                success: false,
                error: kakaoSignupFailure(
                    error.response?.status ?? 500,
                    error.response?.data,
                ),
            };
        }

        return {
            success: false,
            error: KAKAO_SIGNUP_FAILURE_COPY,
        };
    }
}
