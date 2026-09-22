import { NextResponse } from "next/server";
import {
    authRequiredResponse,
    getAuthHeaders,
    getAuthToken,
    logUpstreamError,
    upstreamFetchErrorResponse,
    upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";
import type { NextRequest } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL;

export async function POST(request: NextRequest) {
    if (process.env.NODE_ENV === 'production') {
        return upstreamStatusProblemResponse(403, "send test broadcast", "NOT_APPLIED");
    }

    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    if (!BACKEND_URL) {
        return upstreamStatusProblemResponse(500, "send test broadcast", "UNKNOWN");
    }

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/test-broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
        });

        // A problem+json upstream body is propagated faithfully; a legacy body
        // is sanitized to the Korean catalog copy with the status preserved.
        if (!response.ok) {
            return upstreamFetchErrorResponse(response, "send test broadcast", "mutation");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        logUpstreamError("send test broadcast", error);
        return upstreamStatusProblemResponse(500, "send test broadcast", "UNKNOWN");
    }
}
