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

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    if (!BACKEND_URL) {
        return upstreamStatusProblemResponse(500, "list notification recipients", "UNKNOWN");
    }

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/recipients`, {
            method: "GET",
            headers: getAuthHeaders(token),
        });

        if (!response.ok) {
            return upstreamFetchErrorResponse(response, "list notification recipients", "read");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        logUpstreamError("list notification recipients", error);
        return upstreamStatusProblemResponse(500, "list notification recipients", "UNKNOWN");
    }
}
