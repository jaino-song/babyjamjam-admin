"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { normalizeApiError } from "@babyjamjam/shared";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
}

interface TokenExchangeSuccessResponse {
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
    requiresOrgSelection?: boolean;
}

interface TokenExchangePendingSignupResponse {
    onboardingRequired: true;
    onboardingRoute: "/kakao/onboarding";
    pendingSignupToken: string;
    prefill: {
        email?: string;
        name?: string;
        profileImage?: string;
    };
}

interface TokenExchangeAccountOnboardingResponse {
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

type TokenExchangeResponse =
    | TokenExchangeSuccessResponse
    | TokenExchangePendingSignupResponse
    | TokenExchangeAccountOnboardingResponse;

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";

// Locally authored failure copy — upstream body messages and Error.message
// internals are never forwarded to the client flow.
const TOKEN_EXCHANGE_FAILURE_COPY = "카카오 로그인에 실패했어요. 다시 로그인해 주세요.";
const TOKEN_EXCHANGE_UNREACHABLE_COPY = "로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";

const TRANSPORT_ERROR_CODES = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EAI_AGAIN",
]);

function isTransportFailure(error: AxiosError): boolean {
    // Compare transport state (no response, or an axios transport code) —
    // never the raw "Network Error" message text.
    return !error.response || (typeof error.code === "string" && TRANSPORT_ERROR_CODES.has(error.code));
}

function tokenExchangeFailure(status: number, data: unknown): string {
    const normalized = normalizeApiError(
        { response: { status, data } },
        { locale: "ko-KR", operation: "mutation" },
    );
    return normalized.verified ? normalized.message : TOKEN_EXCHANGE_FAILURE_COPY;
}

function isPendingSignupResponse(data: TokenExchangeResponse): data is TokenExchangePendingSignupResponse {
    return "onboardingRequired" in data && data.onboardingRequired === true && data.onboardingRoute === "/kakao/onboarding";
}

function isAccountOnboardingResponse(data: TokenExchangeResponse): data is TokenExchangeAccountOnboardingResponse {
    return "onboardingRequired" in data && data.onboardingRequired === true && data.onboardingRoute === "/onboarding";
}

export async function exchangeToken(
    code: string,
): Promise<{
    success: boolean;
    error?: string;
    requiresBranchSelection?: boolean;
    onboardingRequired?: boolean;
    onboardingRoute?: "/kakao/onboarding" | "/onboarding";
}> {
    try {
        if (!code) {
            return { success: false, error: "인증 코드가 없어요. 다시 로그인해 주세요." };
        }

        const response = await serverAPIClient.post<TokenExchangeResponse>("/auth/token", { code });

        if (response.status >= 400) {
            return { success: false, error: tokenExchangeFailure(response.status, response.data) };
        }

        const { data } = response;
        const cookieStore = await cookies();
        const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

        if (isPendingSignupResponse(data)) {
            cookieStore.set(PENDING_KAKAO_SIGNUP_COOKIE, data.pendingSignupToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });

            cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);
            clearAuthSessionCookies(cookieStore);

            return { success: true, onboardingRequired: true, onboardingRoute: data.onboardingRoute };
        }

        if (isAccountOnboardingResponse(data)) {
            cookieStore.set(PENDING_ACCOUNT_ONBOARDING_COOKIE, data.pendingAccountOnboardingToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });

            cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
            clearAuthSessionCookies(cookieStore);

            return { success: true, onboardingRequired: true, onboardingRoute: data.onboardingRoute };
        }

        setAuthSessionCookies(cookieStore, {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
        });

        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
        cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);

        return {
            success: true,
            requiresBranchSelection: Boolean(data.requiresBranchSelection || data.requiresOrgSelection),
        };
    } catch (error) {
        console.error("[Server Action] Token Exchange Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            if (isTransportFailure(axiosError)) {
                return { success: false, error: TOKEN_EXCHANGE_UNREACHABLE_COPY };
            }

            return {
                success: false,
                error: tokenExchangeFailure(
                    axiosError.response?.status ?? 500,
                    axiosError.response?.data,
                ),
            };
        }

        return {
            success: false,
            error: TOKEN_EXCHANGE_FAILURE_COPY,
        };
    }
}
