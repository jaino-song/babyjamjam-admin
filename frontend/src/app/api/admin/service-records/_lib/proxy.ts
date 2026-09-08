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

/**
 * Parse a mutation body without letting malformed JSON become an empty start
 * request. An omitted/whitespace-only body is the optional `{}` start body;
 * every other non-object JSON value is rejected by the caller.
 */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
    const raw = await request.text();
    if (!raw.trim()) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
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
