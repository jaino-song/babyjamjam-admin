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
        return upstreamStatusProblemResponse(500, "send notification", "UNKNOWN");
    }

    let body: Record<string, unknown>;
    try {
        body = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }
        logUpstreamError("send notification", error);
        return upstreamStatusProblemResponse(500, "send notification", "UNKNOWN");
    }

    // Forward only the fields the backend's SendNotificationDto accepts —
    // never pass the raw client body through untouched.
    const payload = {
        userId: body.userId,
        title: body.title,
        body: body.body,
    };

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
            body: JSON.stringify(payload),
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
