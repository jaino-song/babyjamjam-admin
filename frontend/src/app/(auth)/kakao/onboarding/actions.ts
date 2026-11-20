"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { normalizeApiError } from "@babyjamjam/shared";
import { getFieldMessageText } from "@/lib/forms/field-message-text";

interface CompleteKakaoOnboardingInput {
    phone: string;
    birthDate: string;
    role: string;
}

interface CompleteKakaoOnboardingSuccessResponse {
    success: boolean;
    message?: string;
    linkVerificationRequired?: boolean;
    linkChallengeToken?: string;
}

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_KAKAO_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";

// Locally authored failure copy — upstream body messages and Error.message
// internals are never forwarded to the client flow.
const KAKAO_SIGNUP_FAILURE_COPY = "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";

export async function completeKakaoOnboarding(
    input: CompleteKakaoOnboardingInput,
): Promise<{ success: boolean; error?: string; field?: "phone" | "birthDate"; linkVerificationRequired?: boolean; linkChallengeToken?: string }> {
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

        if (response.data.linkVerificationRequired) {
            return { success: true, linkVerificationRequired: true, linkChallengeToken: response.data.linkChallengeToken };
        }
        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);

        return {
            success: true,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            const status = error.response?.status ?? 500;
            if (status === 401) {
                cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
                return { success: false, error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요." };
            }
            const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
            if (status === 400 && normalized.problem?.code === "VALIDATION_FAILED") {
                const issue = normalized.problem.errors?.find((item) => item.pointer === "/phone" || item.pointer === "/birthDate");
                if (issue) return { success: false, field: issue.pointer === "/phone" ? "phone" : "birthDate", error:
                    issue.pointer === "/phone" && issue.code === "INVALID_VALUE"
                    ? "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요."
                    : getFieldMessageText("ko", {
                        tone: "error",
                        code: issue.code === "REQUIRED" ? "required" : issue.pointer === "/phone" ? "phone-format" : "date-format",
                    }, issue.pointer === "/phone" ? "전화번호" : "생년월일") };
            }
            return { success: false, error: status === 429 ? (normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.") : KAKAO_SIGNUP_FAILURE_COPY };
        }
        return { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
    }
}

export async function verifyKakaoLink(challengeToken: string, code: string): Promise<{ success: boolean; error?: string }> {
    const store = await cookies();
    const token = store.get(PENDING_KAKAO_SIGNUP_COOKIE)?.value;
    const expired = "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요.";
    if (!token) return { success: false, error: expired };
    try {
        await serverAPIClient.post("/auth/kakao/link/verify", { challengeToken, code }, { headers: { [PENDING_KAKAO_SIGNUP_TOKEN_HEADER]: token } });
        store.delete(PENDING_KAKAO_SIGNUP_COOKIE);
        return { success: true };
    } catch (error) {
        const status = error instanceof AxiosError ? error.response?.status : undefined;
        if (status === 401) {
            store.delete(PENDING_KAKAO_SIGNUP_COOKIE);
            return { success: false, error: expired };
        }
        const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
        return { success: false, error: normalized.problem?.code === "VALIDATION_FAILED" && normalized.problem.errors?.some((item) => item.pointer === "/code")
            ? "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요."
            : status === 429 ? (normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.") : KAKAO_SIGNUP_FAILURE_COPY };
    }
}
