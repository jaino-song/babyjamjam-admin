"use server"

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    decodeAccessBranchId,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";
import { normalizeApiError, type NormalizedApiError } from "@babyjamjam/shared";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: "access" | "refresh";
}

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

interface LoginOnboardingResponse {
    success: true;
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

function isLoginOnboardingResponse(data: unknown): data is LoginOnboardingResponse {
    return typeof data === "object"
        && data !== null
        && "onboardingRequired" in data
        && data.onboardingRequired === true;
}

// Locally authored failure copy — upstream body messages and Error.message
// internals are never forwarded to the client flow.
const LOGIN_INVALID_CREDENTIALS_COPY = "이메일 또는 비밀번호가 올바르지 않아요.";
const LOGIN_FAILURE_COPY = "로그인에 실패했어요.";
const LOGIN_UNKNOWN_FAILURE_COPY = "알 수 없는 오류가 발생했어요.";
const EMAIL_VERIFICATION_REQUIRED_COPY = "이메일 인증이 필요해요. 이메일을 확인해 주세요.";

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

function resolveAutoLoginCookieValue(autoLogin: boolean): "1" | "0" {
    return autoLogin ? "1" : "0";
}

function isAutoLoginCookieEnabled(value: string | undefined): boolean {
    return value === "1";
}

export async function loginWithEmail(email: string, password: string, autoLogin = true): Promise<LoginResult> {
    try {
        console.log("[Server Action] Logging in with email");

        const { data, status } = await serverAPIClient.post("/auth/login", { email, password });

        // Handle error responses
        if (status >= 400 || !data.success) {
            const normalized = normalizeLoginFailure(status, data);
            const emailVerificationRequired = isEmailVerificationProblem(normalized);
            return {
                success: false,
                // Registered problem message (verified) or locally authored
                // copy — the upstream body message is never forwarded.
                error: emailVerificationRequired
                    ? EMAIL_VERIFICATION_REQUIRED_COPY
                    : (normalized.verified ? normalized.message : LOGIN_INVALID_CREDENTIALS_COPY),
                authErrorCode: normalized.verified && normalized.problem
                    ? normalized.problem.code
                    : readLegacyCode(data),
                emailVerificationRequired,
            };
        }

        // Store tokens in httpOnly cookies
        const cookieStore = await cookies();
        const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

        if (isLoginOnboardingResponse(data)) {
            cookieStore.set("pending_account_onboarding", data.pendingAccountOnboardingToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });
            cookieStore.delete("pending_kakao_signup");
            cookieStore.delete("auth_token");
            cookieStore.delete("refresh_token");
            cookieStore.delete("auto_login");

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: data.onboardingRoute,
            };
        }

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        const authCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...authCookieBaseOptions,
                maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
            });
        } else {
            cookieStore.set("auth_token", data.accessToken, authCookieBaseOptions);
        }

        const refreshCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("refresh_token", data.refreshToken, {
                ...refreshCookieBaseOptions,
                maxAge: getRefreshSessionMaxAgeSeconds(role),
            });
        } else {
            cookieStore.set("refresh_token", data.refreshToken, refreshCookieBaseOptions);
        }

        const autoLoginCookieValue = resolveAutoLoginCookieValue(autoLogin);
        const autoLoginEnabled = isAutoLoginCookieEnabled(autoLoginCookieValue);
        if (autoLoginEnabled) {
            cookieStore.set("auto_login", autoLoginCookieValue, {
                ...authCookieBaseOptions,
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.set("auto_login", autoLoginCookieValue, authCookieBaseOptions);
        }

        // middleware.ts gates every non-auth route on the selected_branch_id
        // cookie. When the backend has already resolved a single accessible
        // branch into the access token (requiresBranchSelection is false),
        // reflect that branch here now — otherwise the user is bounced
        // through /select-branch on the very next navigation.
        //
        // Every other case must CLEAR the cookie: this token carries no
        // authorised branch, and a stale value left by a previous account on
        // this device would otherwise satisfy the middleware gate and wave
        // this login through to /dashboard with someone else's branch.
        const branchId = data.requiresBranchSelection
            ? null
            : decodeAccessBranchId(data.accessToken);
        if (branchId) {
            cookieStore.set("selected_branch_id", branchId, {
                httpOnly: false,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.delete("selected_branch_id");
        }

        console.log("[Server Action] Email login successful");
        console.log("[Server Action] requiresBranchSelection:", data.requiresBranchSelection);

        // Use requiresBranchSelection from backend response
        return { success: true, requiresBranchSelection: data.requiresBranchSelection || false };
    } catch (error) {
        console.error("[Server Action] Email Login Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            console.error("[Server Action] Axios Error:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
            });

            if (isTransportFailure(axiosError)) {
                return { success: false, error: "서버에 연결할 수 없어요. 다시 시도해 주세요." };
            }

            const responseStatus = axiosError.response?.status ?? 500;
            const responseBody: unknown = axiosError.response?.data;
            const normalized = normalizeLoginFailure(responseStatus, responseBody);
            return {
                success: false,
                // Registered problem message (verified) or locally authored
                // copy — the upstream body message is never forwarded.
                error: normalized.verified ? normalized.message : LOGIN_FAILURE_COPY,
                authErrorCode: normalized.verified && normalized.problem
                    ? normalized.problem.code
                    : readLegacyCode(responseBody),
            };
        }

        return {
            success: false,
            error: LOGIN_UNKNOWN_FAILURE_COPY
        };
    }
}
