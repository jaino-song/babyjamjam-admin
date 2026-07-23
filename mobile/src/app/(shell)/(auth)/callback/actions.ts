"use server"

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: "access" | "refresh";
}

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

interface TokenExchangeOnboardingResponse {
    onboardingRequired: true;
    onboardingRoute: "/kakao/onboarding" | "/onboarding";
    pendingSignupToken?: string;
    pendingAccountOnboardingToken?: string;
}

type TokenExchangeResponse = TokenExchangeSuccessResponse | TokenExchangeOnboardingResponse;

const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";

function isOnboardingResponse(data: TokenExchangeResponse): data is TokenExchangeOnboardingResponse {
    return "onboardingRequired" in data && data.onboardingRequired === true;
}

export async function exchangeToken(code: string): Promise<{
    success: boolean;
    error?: string;
    requiresBranchSelection?: boolean;
    onboardingRequired?: boolean;
    onboardingRoute?: "/kakao/onboarding" | "/onboarding";
}> {
    try {
        console.log("[Server Action] Exchanging token for code");
        
        if (!code) {
            return { success: false, error: "Authorization Code Required" };
        }

        const { data } = await serverAPIClient.post<TokenExchangeResponse>("/auth/token", { code });

        const cookieStore = await cookies();
        const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

        if (isOnboardingResponse(data)) {
            const isKakaoSignup = data.onboardingRoute === "/kakao/onboarding";
            const pendingToken = isKakaoSignup
                ? data.pendingSignupToken
                : data.pendingAccountOnboardingToken;

            if (!pendingToken) {
                return { success: false, error: "온보딩 세션을 시작하지 못했습니다." };
            }

            cookieStore.set(
                isKakaoSignup ? PENDING_KAKAO_SIGNUP_COOKIE : PENDING_ACCOUNT_ONBOARDING_COOKIE,
                pendingToken,
                {
                    httpOnly: true,
                    secure: isSecureCookie,
                    sameSite: "lax",
                    path: "/",
                    maxAge: 30 * 60,
                },
            );
            cookieStore.delete(isKakaoSignup ? PENDING_ACCOUNT_ONBOARDING_COOKIE : PENDING_KAKAO_SIGNUP_COOKIE);
            cookieStore.delete("auth_token");
            cookieStore.delete("refresh_token");
            cookieStore.delete("auto_login");

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: data.onboardingRoute,
            };
        }

        const loginData = data as TokenExchangeSuccessResponse;

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(loginData.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        cookieStore.set("auth_token", loginData.accessToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
        });

        cookieStore.set("refresh_token", loginData.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: getRefreshSessionMaxAgeSeconds(role),
        });

        console.log("[Server Action] Token exchange successful");
        console.log("[Server Action] requiresBranchSelection:", loginData.requiresBranchSelection);

        return {
            success: true,
            requiresBranchSelection: loginData.requiresBranchSelection || loginData.requiresOrgSelection || false,
        };
    } catch (error) {
        console.error("[Server Action] Token Exchange Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            console.error("[Server Action] Axios Error:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
            });

            if (axiosError.code === 'ECONNABORTED' || axiosError.message === 'Network Error') {
                return { success: false, error: "Backend server unreachable. Please try again later." };
            }

            return { 
                success: false, 
                error: axiosError.response?.data?.message || "Token Exchange Failed" 
            };
        }

        return { 
            success: false, 
            error: error instanceof Error ? error.message : "Unknown error" 
        };
    }
}
