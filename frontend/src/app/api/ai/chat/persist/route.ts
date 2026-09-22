import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import {
    authRequiredResponse,
    invalidJsonResponse,
    logUpstreamError,
    readJsonObjectBody,
    upstreamStatusProblemResponse,
    upstreamFetchErrorResponse,
} from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return authRequiredResponse();
    }

    let body: unknown;
    try {
        body = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        throw error;
    }

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/persist`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
        });

        if (!backendResponse.ok) {
            return upstreamFetchErrorResponse(backendResponse, "persist chat message", "mutation");
        }

        const result = await backendResponse.json();
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        // Transport failure: whether the transcript was stored is unconfirmable.
        logUpstreamError("persist chat message", error);
        return upstreamStatusProblemResponse(502, "persist chat message", "UNKNOWN");
    }
}
