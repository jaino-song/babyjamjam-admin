import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";
import { z } from "zod";

import { getUpstreamErrorStatus, logUpstreamError, parseBody, sanitizeUpstreamClientError } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";

// Mirrors backend LoginDto (email-auth.dto.ts): email is @IsEmail() and
// password is @IsString() @IsNotEmpty(), both required. autoLogin is a
// frontend-only flag controlling cookie maxAge (not forwarded to the backend).
// Passthrough preserves any forward-compatible login fields.
const loginSchema = z
    .object({
        email: z.string().email(),
        password: z.string().min(1),
        autoLogin: z.boolean().optional(),
    })
    .passthrough();

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

export async function POST(request: NextRequest) {
    const { data: parsed, response: invalid } = await parseBody(loginSchema, request);
    if (invalid) return invalid;

    try {
        const { autoLogin = true, ...loginPayload } = parsed;
        const { data, status } = await serverAPIClient.post("/auth/login", loginPayload);

        // If login failed, return the response
        if (!data.success || !data.accessToken) {
            return NextResponse.json(data, { status: status || 401 });
        }

        // Set auth cookies on successful login
        const cookieStore = await cookies();
        const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("Failed to decode token");
        }

        const isPrivileged = ["owner", "admin", "manager"].includes(role);

        const baseCookieOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax" as const,
            path: "/",
        };

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...baseCookieOptions,
                maxAge: isPrivileged ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
            });
            cookieStore.set("refresh_token", data.refreshToken, {
                ...baseCookieOptions,
                maxAge: isPrivileged ? 7 * 24 * 60 * 60 : 1 * 24 * 60 * 60,
            });
            cookieStore.set("auto_login", "1", {
                ...baseCookieOptions,
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.set("auth_token", data.accessToken, baseCookieOptions);
            cookieStore.set("refresh_token", data.refreshToken, baseCookieOptions);
            cookieStore.set("auto_login", "0", baseCookieOptions);
        }

        return NextResponse.json({
            success: true,
            message: "로그인 성공",
            requiresBranchSelection: data.requiresBranchSelection,
        }, { status: 200 });
    } catch (error) {
        logUpstreamError("Auth Login", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = getUpstreamErrorStatus(error);
            const responseData = axiosError.response?.data;

            return NextResponse.json(
                sanitizeUpstreamClientError(responseData, "Login failed"),
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
