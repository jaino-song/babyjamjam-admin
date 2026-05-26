import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { BACKEND_BASE_URL, serverAPIClient } from "@/lib/api/server";
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

const isProduction = process.env.NODE_ENV === "production";
const isSecureCookie = isProduction || process.env.VERCEL_ENV === "preview";
const API_URL = BACKEND_BASE_URL;

// 30일 세션을 부여받는 권한 있는 역할들
const EXTENDED_SESSION_ROLES = ["owner", "creator"] as const;
const EXTENDED_SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_SESSION_MAX_AGE = 3 * 24 * 60 * 60;   // 3 days

export async function POST(request: NextRequest) {
    try {
        const { code } = await request.json();

        if (!code) {
            console.error("[Token Exchange] No code provided");
            return NextResponse.json({ error: "Authorization Code Required" }, { status: 400 });
        }

        const { data } = await serverAPIClient.post("/auth/token", { code });

        const cookieStore = await cookies();

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        }
        catch {
            console.error("Failed to decode token");
        }

        cookieStore.set("auth_token", data.accessToken, {
            httpOnly: true,
            // In local dev (http://localhost), secure cookies will not be stored/sent by browsers.
            // Use sameSite=lax in dev to keep auth working; keep sameSite=none in prod/preview for OAuth flows.
            secure: isSecureCookie,
            sameSite: isSecureCookie ? "none" : "lax",
            path: "/",
            maxAge: ["owner", "creator"].includes(role) ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        })

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: isSecureCookie ? "none" : "lax",
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
                console.error("Error Code:", (error as any).code);
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
