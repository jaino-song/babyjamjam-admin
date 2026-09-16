import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    getUpstreamErrorStatus,
    logUpstreamError,
    upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { AUTH_COOKIE_NAMES } from "@/lib/auth/session-policy";

interface RefreshResponse {
    accessToken?: unknown;
    refreshToken?: unknown;
}

// Upstream answered, but without a usable token pair. The session cannot be
// recovered, so this must surface as 401 (and clear cookies) rather than as a
// transient 502 — the browser interceptor only redirects to /login on a 401,
// and a 502 would strand the tab issuing 401s forever.
class UnrecoverableRefreshError extends Error {}

function isAutoLoginEnabled(value: string | undefined): boolean {
    return value !== "0" && value !== "false";
}

function hasUpstreamResponse(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && (error as { response?: unknown }).response,
    );
}

export async function POST(request: NextRequest) {
    const refreshToken = request.cookies.get(AUTH_COOKIE_NAMES.refreshToken)?.value;
    if (!refreshToken) {
        return authRequiredResponse();
    }

    try {
        const response = await serverAPIClient.post<RefreshResponse>("/auth/refresh-token", {
            refreshToken,
        });
        const accessToken = response.data.accessToken;
        const rotatedRefreshToken = response.data.refreshToken;
        if (typeof accessToken !== "string" || typeof rotatedRefreshToken !== "string") {
            throw new UnrecoverableRefreshError("Auth refresh response is missing tokens");
        }

        const cookieStore = await cookies();
        setAuthSessionCookies(cookieStore, {
            accessToken,
            refreshToken: rotatedRefreshToken,
            autoLogin: isAutoLoginEnabled(
                request.cookies.get(AUTH_COOKIE_NAMES.autoLogin)?.value,
            ),
        });

        const result = NextResponse.json({ success: true });
        result.headers.set("Cache-Control", "no-store, max-age=0");
        return result;
    } catch (error) {
        const status = error instanceof UnrecoverableRefreshError
            ? 401
            : getUpstreamErrorStatus(error, 502);
        logUpstreamError("refresh app session", error);

        if (status === 401) {
            const cookieStore = await cookies();
            clearAuthSessionCookies(cookieStore);
        }

        // An upstream rejection is a known non-application (NOT_APPLIED); a
        // transport failure leaves the rotation result unconfirmable (UNKNOWN,
        // which carries CHECK_STATUS recovery in the problem contract).
        const outcome = hasUpstreamResponse(error) ? "NOT_APPLIED" : "UNKNOWN";
        const result = upstreamStatusProblemResponse(status, "refresh app session", outcome);
        result.headers.set("Cache-Control", "no-store, max-age=0");
        return result;
    }
}
