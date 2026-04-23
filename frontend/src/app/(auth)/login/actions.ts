"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import axios, { AxiosError } from "axios";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
}

interface LoginResult {
    success: boolean;
    error?: string;
    requiresBranchSelection?: boolean;
    emailVerificationRequired?: boolean;
    onboardingRequired?: boolean;
    onboardingRoute?: "/onboarding";
}

interface LoginSuccessResponse {
    success: true;
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
    requiresOrgSelection?: boolean;
}

interface LoginOnboardingResponse {
    success: true;
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

type LoginResponsePayload = LoginSuccessResponse | LoginOnboardingResponse | {
    success?: false;
    message?: string;
};

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const NETWORK_ERROR_CODES = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EAI_AGAIN",
]);

function isLoginOnboardingResponse(data: LoginResponsePayload): data is LoginOnboardingResponse {
    return typeof data === "object" && !!data && "onboardingRequired" in data && data.onboardingRequired === true;
}

function isBackendConnectionError(error: AxiosError): boolean {
    return (
        !error.response ||
        error.message === "Network Error" ||
        (typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code))
    );
}

export async function loginWithEmail(email: string, password: string, autoLogin = true): Promise<LoginResult> {
    try {
        const { data, status } = await serverAPIClient.post<LoginResponsePayload>("/auth/login", { email, password });

        // Handle error responses
        if (status >= 400 || !data.success) {
            const message = typeof data === "object" && data && "message" in data
                ? data.message
                : undefined;
            return {
                success: false,
                error: message || "이메일 또는 비밀번호가 올바르지 않습니다.",
                emailVerificationRequired: message?.includes("이메일 인증"),
            };
        }

        // Store tokens in httpOnly cookies
        const cookieStore = await cookies();
        const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

        if (isLoginOnboardingResponse(data)) {
            cookieStore.set(PENDING_ACCOUNT_ONBOARDING_COOKIE, data.pendingAccountOnboardingToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });

            cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
            clearAuthSessionCookies(cookieStore);

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: data.onboardingRoute,
            };
        }

        const loginData = data as LoginSuccessResponse;

        setAuthSessionCookies(cookieStore, {
            accessToken: loginData.accessToken,
            refreshToken: loginData.refreshToken,
            autoLogin,
        });

        cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);
        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);

        return {
            success: true,
            requiresBranchSelection: Boolean(
                loginData.requiresBranchSelection || loginData.requiresOrgSelection,
            ),
        };
    } catch (error) {
        console.error("[Server Action] Email Login Error:", error);

        if (axios.isAxiosError<APIErrorResponse>(error)) {
            const axiosError = error;
            console.error("[Server Action] Axios Error:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
            });

            if (isBackendConnectionError(axiosError)) {
                return { success: false, error: "로그인 서버에 연결할 수 없습니다. 백엔드 서버를 확인해 주세요." };
            }

            return {
                success: false,
                error: axiosError.response?.data?.message || "로그인에 실패했습니다."
            };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
        };
    }
}
