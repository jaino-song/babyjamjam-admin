import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { logUpstreamError, sanitizeUpstreamClientError } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

interface TokenPayload {
    role: string | null;
}

interface RefreshResponse {
    accessToken: string;
    refreshToken?: string;
}

interface APIErrorResponse {
    statusCode: number;
    code?: string;
    message: string;
    error: string;
}

function isAutoLoginEnabled(value: string | undefined): boolean {
    return value !== "0" && value !== "false";
}

function clearAuthCookies(response: NextResponse): void {
    response.cookies.delete("auth_token");
    response.cookies.delete("refresh_token");
}

function decodeRole(token: string): string {
    try {
        const decoded = jwtDecode<TokenPayload>(token);
        return decoded.role || "user";
    } catch {
        return "user";
    }
}

function setSessionCookies(response: NextResponse, params: {
    accessToken: string;
    refreshToken: string;
    role: string;
    autoLogin: boolean;
}): void {
    const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

    const baseCookieOptions = {
        httpOnly: true,
        secure: isSecureCookie,
        sameSite: "lax" as const,
        path: "/",
    };

    if (params.autoLogin) {
        response.cookies.set("auth_token", params.accessToken, {
            ...baseCookieOptions,
            maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
        });
        response.cookies.set("refresh_token", params.refreshToken, {
            ...baseCookieOptions,
            maxAge: getRefreshSessionMaxAgeSeconds(params.role),
        });
        response.cookies.set("auto_login", "1", {
            ...baseCookieOptions,
            maxAge: 30 * 24 * 60 * 60,
        });
        return;
    }

    response.cookies.set("auth_token", params.accessToken, baseCookieOptions);
    response.cookies.set("refresh_token", params.refreshToken, baseCookieOptions);
    response.cookies.set("auto_login", "0", baseCookieOptions);
}

export async function POST() {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;

    if (!refreshToken) {
        const response = NextResponse.json({ error: "Refresh token not found" }, { status: 401 });
        clearAuthCookies(response);
        return response;
    }

    const autoLogin = isAutoLoginEnabled(cookieStore.get("auto_login")?.value);

    try {
        const { data } = await serverAPIClient.post<RefreshResponse>("/auth/refresh-token", {
            refreshToken,
        });

        if (!data?.accessToken) {
            const response = NextResponse.json({ error: "Invalid refresh response" }, { status: 401 });
            clearAuthCookies(response);
            return response;
        }

        const role = decodeRole(data.accessToken);
        const nextRefreshToken = data.refreshToken || refreshToken;

        const response = NextResponse.json({ success: true }, { status: 200 });
        setSessionCookies(response, {
            accessToken: data.accessToken,
            refreshToken: nextRefreshToken,
            role,
            autoLogin,
        });
        return response;
    } catch (error) {
        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = axiosError.response?.status || 500;
            logUpstreamError("refresh authentication", error);
            if (
                status === 401
                && axiosError.response?.data?.code === "AUTH_REFRESH_REPLAY_CONCURRENT"
            ) {
                const response = NextResponse.json(
                    {
                        code: "AUTH_REFRESH_REPLAY_CONCURRENT",
                        error: "Authentication refresh already in progress",
                    },
                    { status: 409 },
                );
                response.headers.set("Retry-After", "1");
                return response;
            }

            const response = NextResponse.json(
                sanitizeUpstreamClientError(
                    axiosError.response?.data,
                    "Failed to refresh authentication"
                ),
                { status }
            );
            if (status === 401 || status === 403) {
                clearAuthCookies(response);
            }
            return response;
        }

        return NextResponse.json({ error: "Failed to refresh authentication" }, { status: 500 });
    }
}
