import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ clientId: string }> };

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

function jsonResponse(body: unknown, status: number): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { clientId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/client/${encodeURIComponent(clientId)}/editor`,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return jsonResponse(error.response.data ?? { error: "Request failed" }, error.response.status);
        }
        console.error("[API] Error fetching service-record editor:", error);
        return jsonResponse({ error: "Failed to fetch service records" }, 500);
    }
}
