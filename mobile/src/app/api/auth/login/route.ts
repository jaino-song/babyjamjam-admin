import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { jwtDecode } from "jwt-decode";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api/route-utils";
import { upstreamBodyErrorResponse } from "@/lib/api/problem-responses";
import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

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

export async function POST(request: NextRequest) {
    const { data: parsed, response: invalid } = await parseBody(loginSchema, request);
    if (invalid) return invalid;

    try {
        const { autoLogin = true, ...loginPayload } = parsed;
        const { data, status } = await serverAPIClient.post("/auth/login", loginPayload);

        // If login failed, propagate the upstream failure through the problem
        // boundary: verbatim problem bodies keep their status and headers,
        // other bodies get the sanitized fallback without raw passthrough.
        if (!data.success || !data.accessToken) {
            return upstreamBodyErrorResponse(status || 401, JSON.stringify(data), "login", "mutation");
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

        const baseCookieOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax" as const,
            path: "/",
        };

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...baseCookieOptions,
                maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
            });
            cookieStore.set("refresh_token", data.refreshToken, {
                ...baseCookieOptions,
                maxAge: getRefreshSessionMaxAgeSeconds(role),
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
        return errorResponse(error, "login");
    }
}
