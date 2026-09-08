import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

export function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export function getAuthHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

export function jsonResponse(body: unknown, status: number): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

export function upstreamError(error: unknown, fallback: string): NextResponse {
    if (isAxiosError(error) && error.response) {
        return jsonResponse(error.response.data ?? { error: "Request failed" }, error.response.status);
    }
    // Keep private upstream details out of the response and server log.
    void error;
    console.error(`[API] ${fallback}`);
    return jsonResponse({ error: fallback }, 500);
}

export { serverAPIClient };
