import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import {
    errorResponse,
    invalidJsonResponse,
    localValidationProblemResponse,
    logUpstreamError,
    readJsonObjectBody,
    upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";

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

const isProduction = process.env.NODE_ENV === "production";
const isSecureCookie = isProduction || process.env.VERCEL_ENV === "preview";
const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";

function isPendingSignupResponse(data: TokenExchangeResponse): data is TokenExchangePendingSignupResponse {
    return "onboardingRequired" in data && data.onboardingRequired === true && data.onboardingRoute === "/kakao/onboarding";
}

function isAccountOnboardingResponse(data: TokenExchangeResponse): data is TokenExchangeAccountOnboardingResponse {
    return "onboardingRequired" in data && data.onboardingRequired === true && data.onboardingRoute === "/onboarding";
}

export async function POST(request: NextRequest) {
    try {
        const { code } = await readJsonObjectBody(request);

        if (typeof code !== "string" || code.length === 0) {
            console.error("[Token Exchange] No code provided");
            return localValidationProblemResponse([
                { pointer: "/code", code: "REQUIRED", detail: "Invalid input", location: "body" },
            ]);
        }

        const response = await serverAPIClient.post<TokenExchangeResponse>("/auth/token", { code });

        if (response.status >= 400) {
            return errorResponse({ response }, "exchange authorization code");
        }

        const { data } = response;
        const cookieStore = await cookies();

        if (isPendingSignupResponse(data)) {
            cookieStore.set(PENDING_KAKAO_SIGNUP_COOKIE, data.pendingSignupToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: isSecureCookie ? "none" : "lax",
                path: "/",
                maxAge: 30 * 60,
            });

            cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);
            clearAuthSessionCookies(cookieStore);

            return NextResponse.json({ onboardingRequired: true, onboardingRoute: data.onboardingRoute }, { status: 200 });
        }

        if (isAccountOnboardingResponse(data)) {
            cookieStore.set(PENDING_ACCOUNT_ONBOARDING_COOKIE, data.pendingAccountOnboardingToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: isSecureCookie ? "none" : "lax",
                path: "/",
                maxAge: 30 * 60,
            });

            cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
            clearAuthSessionCookies(cookieStore);

            return NextResponse.json({ onboardingRequired: true, onboardingRoute: data.onboardingRoute }, { status: 200 });
        }

        setAuthSessionCookies(cookieStore, {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
        });

        cookieStore.delete(PENDING_KAKAO_SIGNUP_COOKIE);
        cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);

        return NextResponse.json({
            message: "Success",
            requiresBranchSelection: Boolean(data.requiresBranchSelection || data.requiresOrgSelection),
        }, { status: 200 });
    } catch (error) {
        console.error("Token Exchange Error:", error);
        console.error("Backend URL:", serverAPIClient.defaults?.baseURL);
        console.error("Environment:", process.env.NODE_ENV);

        if (error instanceof Error) {
            console.error("Error Name:", error.name);
            console.error("Error Message:", error.message);
            if ("code" in error) {
                console.error("Error Code:", (error as { code?: string }).code);
            }
        }

        if (error instanceof AxiosError) {
            console.error("Axios Error Details:", {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
            });

            if (error.code === "ECONNABORTED" || error.message === "Network Error") {
                console.error("[Token Exchange] Cannot reach backend server");
                logUpstreamError("exchange authorization code", error);
                // Transport failure: whether the exchange applied is unconfirmable.
                return upstreamStatusProblemResponse(503, "exchange authorization code", "UNKNOWN");
            }

            return errorResponse(error, "exchange authorization code");
        }

        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;

        return errorResponse(error, "exchange authorization code");
    }
}
