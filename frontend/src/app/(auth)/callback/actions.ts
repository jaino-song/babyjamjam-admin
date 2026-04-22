"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";

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
            return { success: false, error: "Authorization Code Required" };
        }

        const response = await serverAPIClient.post<TokenExchangeResponse>("/auth/token", { code });

        if (response.status >= 400) {
            const message = typeof response.data === "object" && response.data && "message" in response.data
                ? String(response.data.message)
                : "Token Exchange Failed";
            return { success: false, error: message };
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
            if (axiosError.code === 'ECONNABORTED' || axiosError.message === 'Network Error') {
                return { success: false, error: "Backend server unreachable. Please try again later." };
            }

            return {
                success: false,
                error: axiosError.response?.data?.message || "Token Exchange Failed",
            };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
