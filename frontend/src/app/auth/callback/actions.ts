"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/app/lib/axios/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { classifyTokenExchangeResponse } from "./token-response";

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

        const cookieStore = await cookies();
        const { data } = await serverAPIClient.post("/auth/token", { code });
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
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });
            cookieStore.delete(stalePendingCookieName);
            cookieStore.delete("auth_token");
            cookieStore.delete("refresh_token");

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: result.onboardingRoute,
            };
        }

        if (result.kind !== "authenticated") {
            return { success: false, error: "Token Exchange Failed" };
        }

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(result.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        cookieStore.set("auth_token", result.accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        });

        cookieStore.set("refresh_token", result.refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        console.log("[Server Action] Token exchange successful");
        cookieStore.delete("pending_kakao_signup");
        cookieStore.delete("pending_account_onboarding");

        return {
            success: true,
            requiresBranchSelection: result.requiresBranchSelection,
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
