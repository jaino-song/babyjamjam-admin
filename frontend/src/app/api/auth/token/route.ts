import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { classifyTokenExchangeResponse } from "@/app/auth/callback/token-response";

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

const isProduction = process.env.NODE_ENV === "production";

export async function POST(request: NextRequest) {
    try {
        const { code } = await request.json();

        if (!code) {
            console.error("[Token Exchange] No code provided");
            return NextResponse.json({ error: "Authorization Code Required" }, { status: 400 });
        }

        const { data } = await serverAPIClient.post("/auth/token", { code });
        const cookieStore = await cookies();
        const result = classifyTokenExchangeResponse(data);

        if (result.kind === "account-onboarding" || result.kind === "kakao-onboarding") {
            const pendingCookieName = result.kind === "account-onboarding"
                ? "pending_account_onboarding"
                : "pending_kakao_signup";
            const stalePendingCookieName = result.kind === "account-onboarding"
                ? "pending_kakao_signup"
                : "pending_account_onboarding";

            cookieStore.set(pendingCookieName, result.pendingToken, {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });
            cookieStore.delete(stalePendingCookieName);
            cookieStore.delete("auth_token");
            cookieStore.delete("refresh_token");

            return NextResponse.json({
                onboardingRequired: true,
                onboardingRoute: result.onboardingRoute,
            });
        }

        if (result.kind !== "authenticated") {
            return NextResponse.json({ error: "Token Exchange Failed" }, { status: 502 });
        }

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(result.accessToken);
            role = decoded.role || "user";
        }
        catch {
            console.error("Failed to decode token");
        }

        cookieStore.set("auth_token", result.accessToken, {
            httpOnly: true,
            secure: true,  // Must be true with sameSite: 'none'
            sameSite: "none",  // Required for mobile browsers during OAuth redirects
            path: "/",
            maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        })

        cookieStore.set("refresh_token", result.refreshToken, {
            httpOnly: true,
            secure: true,  // Must be true with sameSite: 'none'
            sameSite: "none",  // Required for mobile browsers during OAuth redirects
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        })
        return NextResponse.json({ message: "Success" }, { status: 200 });
    } catch (error) {
        console.error("Token Exchange Error:", error);
        console.error("Backend URL:", serverAPIClient.defaults.baseURL);
        console.error("Environment:", process.env.NODE_ENV);

        // Log network error details
        if (error instanceof Error) {
            console.error("Error Name:", error.name);
            console.error("Error Message:", error.message);
            if ('code' in error) {
                console.error("Error Code:", (error as { code?: unknown }).code);
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

            // Network error - backend unreachable
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
