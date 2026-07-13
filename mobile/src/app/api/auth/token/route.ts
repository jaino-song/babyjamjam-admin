import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";
import { z } from "zod";

import { parseBody } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";

// Mirrors backend TokenExchangeDto: code is the required authorization code
// exchanged for tokens. Passthrough preserves forward-compatible fields.
const tokenExchangeSchema = z
    .object({
        code: z.string().min(1),
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
}

const {
    isSecureCookieEnv: isSecureCookie,
} = getServerRuntimeConfig();

// 30일 세션을 부여받는 권한 있는 역할들
const EXTENDED_SESSION_ROLES = new Set(["owner", "creator"]);
const EXTENDED_SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_SESSION_MAX_AGE = 3 * 24 * 60 * 60;   // 3 days

function getErrorCode(error: Error): string | undefined {
    if (!("code" in error)) {
        return undefined;
    }

    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
}

function logTokenExchangeFailure(error: unknown): void {
    const safeDetails: {
        errorName?: string;
        errorCode?: string;
        status?: number;
    } = {};

    if (error instanceof Error) {
        safeDetails.errorName = error.name;
        safeDetails.errorCode = getErrorCode(error);
    }

    if (error instanceof AxiosError) {
        safeDetails.status = error.response?.status;
    }

    console.error("[Token Exchange] Failed", safeDetails);
}

export async function POST(request: NextRequest) {
    const { data: parsed, response: invalid } = await parseBody(tokenExchangeSchema, request);
    if (invalid) return invalid;

    try {
        const { code } = parsed;

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
            maxAge: EXTENDED_SESSION_ROLES.has(role) ? EXTENDED_SESSION_MAX_AGE : DEFAULT_SESSION_MAX_AGE,
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
        logTokenExchangeFailure(error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;

            // Network error - backend unreachable
            if (!axiosError.response) {
                return NextResponse.json(
                    { error: "Authentication service unavailable" },
                    { status: 503 }
                );
            }

            const status = axiosError.response?.status || 500;
            return NextResponse.json({ error: "Token exchange failed" }, { status });
        }

        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
