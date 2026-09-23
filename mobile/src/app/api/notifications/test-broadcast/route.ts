import { NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { accessDeniedProblemResponse, unauthorizedProblemResponse, upstreamBodyErrorResponse, upstreamUnavailableProblemResponse } from "@/lib/api/problem-responses";
import { getServerRuntimeConfig } from "@/lib/env";
import type { NextRequest } from "next/server";

const BACKEND_URL = BACKEND_BASE_URL;

export async function POST(request: NextRequest) {
    if (getServerRuntimeConfig().isProductionNodeEnv) {
        return accessDeniedProblemResponse("Test endpoint disabled in production");
    }

    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
    }

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/test-broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
        });

        if (!response.ok) {
            const upstreamText = await response.text().catch(() => "");
            return upstreamBodyErrorResponse(response.status, upstreamText, "send test broadcast", "mutation");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch {
        return upstreamUnavailableProblemResponse("mutation");
    }
}
