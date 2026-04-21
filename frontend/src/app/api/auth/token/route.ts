import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
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
        const { code } = await request.json();

        if (!code) {
            console.error("[Token Exchange] No code provided");
            return NextResponse.json({ error: "Authorization Code Required" }, { status: 400 });
        }

        const response = await serverAPIClient.post<TokenExchangeResponse>("/auth/token", { code });

        if (response.status >= 400) {
            const message = typeof response.data === "object" && response.data && "message" in response.data
                ? String(response.data.message)
                : "Token Exchange Failed";
            return NextResponse.json({ error: message }, { status: response.status });
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

        return NextResponse.json({ message: "Success", requiresBranchSelection: data.requiresBranchSelection || false }, { status: 200 });
    } catch (error) {
        console.error("Token Exchange Error:", error);
        console.error("Backend URL:", serverAPIClient.defaults.baseURL);
        console.error("Environment:", process.env.NODE_ENV);

        if (error instanceof Error) {
            console.error("Error Name:", error.name);
            console.error("Error Message:", error.message);
            if ("code" in error) {
                console.error("Error Code:", (error as { code?: string }).code);
            }
        }

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            console.error("Axios Error Details:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText,
                data: axiosError.response?.data,
                url: axiosError.config?.url,
                baseURL: axiosError.config?.baseURL,
                timeout: axiosError.config?.timeout,
            });

            if (axiosError.code === 'ECONNABORTED' || axiosError.message === 'Network Error') {
                console.error("[Token Exchange] Cannot reach backend server");
                console.error("[Token Exchange] Backend might be down or unreachable from Vercel");
                return NextResponse.json({
                    error: "Backend server unreachable. Please try again later.",
                    details: "The authentication server is currently unavailable."
                }, { status: 503 });
            }

            const status = axiosError.response?.status || 500;
            const message = axiosError.response?.data?.message || "Token Exchange Failed";
            return NextResponse.json({ error: message }, { status });
        }

        return NextResponse.json({
            error: "Internal Server Error",
            details: error instanceof Error ? error.message : "Unknown error"
        }, { status: 500 });
    }
}
