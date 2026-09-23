"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import axios, { AxiosError } from "axios";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { normalizeApiError, type NormalizedApiError } from "@babyjamjam/shared";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
}

interface LoginResult {
    success: boolean;
    error?: string;
    requiresBranchSelection?: boolean;
    emailVerificationRequired?: boolean;
    onboardingRequired?: boolean;
    onboardingRoute?: "/onboarding";
    authErrorCode?: string;
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
    code?: string;
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
    // Transport state only: no response at all, or an axios transport code.
    // The raw "Network Error" message text is never compared.
    return (
        !error.response ||
        (typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code))
    );
}

function normalizeLoginFailure(status: number, data: unknown): NormalizedApiError {
    return normalizeApiError(
        { response: { status, data } },
        { locale: "ko-KR", operation: "mutation" },
    );
}

/** Registered-code discriminator for the unverified-email login failure. */
function isEmailVerificationProblem(normalized: NormalizedApiError): boolean {
    return normalized.verified
        && normalized.problem?.code === "ACCESS_DENIED"
        && (normalized.problem.errors ?? []).some((problemError) => problemError.pointer === "/email");
}

function readLegacyCode(data: unknown): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
}

export async function loginWithEmail(email: string, password: string, autoLogin = true): Promise<LoginResult> {
    try {
        const { data, status } = await serverAPIClient.post<LoginResponsePayload>("/auth/login", { email, password });

        // Handle error responses
        if (status >= 400 || !data.success) {
            const normalized = normalizeLoginFailure(status, data);
            const emailVerificationRequired = isEmailVerificationProblem(normalized);
            return {
                success: false,
                // Registered problem message (verified) or locally authored
                // copy — the upstream body message is never forwarded.
                error: emailVerificationRequired
                    ? "이메일 인증이 필요해요. 이메일을 확인해 주세요."
                    : (normalized.verified ? normalized.message : "이메일 또는 비밀번호가 올바르지 않아요."),
                authErrorCode: normalized.verified && normalized.problem
                    ? normalized.problem.code
                    : readLegacyCode(data),
                emailVerificationRequired,
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
                return { success: false, error: "로그인 서버에 연결할 수 없어요. 백엔드 서버를 확인해 주세요." };
            }

            const responseStatus = axiosError.response?.status ?? 500;
            const responseBody: unknown = axiosError.response?.data;
            const normalized = normalizeLoginFailure(responseStatus, responseBody);
            const emailVerificationRequired = isEmailVerificationProblem(normalized);
            return {
                success: false,
                // Registered problem message (verified) or locally authored
                // copy — the upstream body message is never forwarded.
                error: emailVerificationRequired
                    ? "이메일 인증이 필요해요. 이메일을 확인해 주세요."
                    : (normalized.verified ? normalized.message : "로그인에 실패했어요."),
                authErrorCode: normalized.verified && normalized.problem
                    ? normalized.problem.code
                    : readLegacyCode(responseBody),
                emailVerificationRequired,
            };
        }

        return {
            success: false,
            error: "알 수 없는 오류로 로그인에 실패했어요."
        };
    }
}
