import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api/route-utils";
import { dependencyUnavailableProblemResponse } from "@/lib/api/problem-responses";
import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

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

const {
    isSecureCookieEnv: isSecureCookie,
} = getServerRuntimeConfig();

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
            maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
        })

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: isSecureCookie ? "none" : "lax",
            path: "/",
            maxAge: getRefreshSessionMaxAgeSeconds(role),
        })
        return NextResponse.json({ message: "Success" }, { status: 200 });
    } catch (error) {
        // Network failure before the exchange completed: the registered
        // DEPENDENCY_UNAVAILABLE problem keeps the established 503 status.
        if (error instanceof AxiosError && !error.response) {
            return dependencyUnavailableProblemResponse("mutation");
        }

        // Upstream rejections keep their status and forward problem bodies;
        // other failures fall back to the sanitized 500 boundary.
        return errorResponse(error, "exchange authorization code");
    }
}
