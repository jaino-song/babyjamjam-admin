"use server"

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";

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

export async function exchangeToken(code: string): Promise<{ success: boolean; error?: string; requiresBranchSelection?: boolean }> {
    try {
        console.log("[Server Action] Exchanging token for code");
        
        if (!code) {
            return { success: false, error: "Authorization Code Required" };
        }

        const { data } = await serverAPIClient.post("/auth/token", { code });

        const cookieStore = await cookies();
        const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        cookieStore.set("auth_token", data.accessToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        });

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax", // Changed to lax for same-origin navigation
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        console.log("[Server Action] Token exchange successful");
        console.log("[Server Action] requiresBranchSelection:", data.requiresBranchSelection);

        return { success: true, requiresBranchSelection: data.requiresBranchSelection || false };
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
