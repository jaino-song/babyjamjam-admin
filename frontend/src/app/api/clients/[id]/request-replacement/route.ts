import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// PATCH /api/clients/[id]/request-replacement - Request employee replacement
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const response = await serverAPIClient.patch(`/clients/${id}/request-replacement`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        // Assignment rejections now arrive as registered problem bodies; the
        // clients-route passthrough keeps their status and code intact while
        // legacy payloads still fall back to the sanitized error response.
        return errorResponse(error, "request employee replacement");
    }
}
