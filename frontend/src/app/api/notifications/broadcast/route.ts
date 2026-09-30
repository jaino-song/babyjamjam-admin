import { NextResponse } from "next/server";
import {
    authRequiredResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    logUpstreamError,
    readJsonObjectBody,
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
        return upstreamStatusProblemResponse(500, "broadcast notification", "UNKNOWN");
    }

    let body: Record<string, unknown>;
    try {
        body = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }
        logUpstreamError("broadcast notification", error);
        return upstreamStatusProblemResponse(500, "broadcast notification", "UNKNOWN");
    }

    // Forward only the fields the backend's BroadcastNotificationDto accepts —
    // never pass the raw client body through untouched.
    const payload = {
        title: body.title,
        body: body.body,
    };

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            return upstreamFetchErrorResponse(response, "broadcast notification", "mutation");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        logUpstreamError("broadcast notification", error);
        return upstreamStatusProblemResponse(500, "broadcast notification", "UNKNOWN");
    }
}
