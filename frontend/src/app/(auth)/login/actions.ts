"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

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

interface LoginResult {
    success: boolean;
    error?: string;
    requiresOrgSelection?: boolean;
    emailVerificationRequired?: boolean;
}

export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
    try {
        console.log("[Server Action] Logging in with email");

        const { data, status } = await serverAPIClient.post("/auth/login", { email, password });

        // Handle error responses
        if (status >= 400 || !data.success) {
            return {
                success: false,
                error: data.message || "이메일 또는 비밀번호가 올바르지 않습니다.",
                emailVerificationRequired: data.message?.includes("이메일 인증")
            };
        }

        // Store tokens in httpOnly cookies
        const cookieStore = await cookies();
        const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

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
            sameSite: "lax",
            path: "/",
            maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        });

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        console.log("[Server Action] Email login successful");
        console.log("[Server Action] requiresOrgSelection:", data.requiresOrgSelection);

        // Use requiresOrgSelection from backend response
        return { success: true, requiresOrgSelection: data.requiresOrgSelection || false };
    } catch (error) {
        console.error("[Server Action] Email Login Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            console.error("[Server Action] Axios Error:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
            });

            if (axiosError.code === 'ECONNABORTED' || axiosError.message === 'Network Error') {
                return { success: false, error: "서버에 연결할 수 없습니다. 다시 시도해 주세요." };
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
