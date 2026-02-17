import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

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
        console.error("[API] Error requesting replacement:", error);
        return NextResponse.json(
            { error: "Failed to request employee replacement" },
            { status: 500 }
        );
    }
}
