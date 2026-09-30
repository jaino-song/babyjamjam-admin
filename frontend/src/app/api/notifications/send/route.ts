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
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    if (!BACKEND_URL) {
        return upstreamStatusProblemResponse(500, "send notification", "UNKNOWN");
    }

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
            body: JSON.stringify(await request.json()),
        });

        if (!response.ok) {
            return upstreamFetchErrorResponse(response, "send notification", "mutation");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        logUpstreamError("send notification", error);
        return upstreamStatusProblemResponse(500, "send notification", "UNKNOWN");
    }
}
