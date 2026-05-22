import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ id: string }> };

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const response = await serverAPIClient.patch(
            `/consultation-inquiries/${id}/read`,
            undefined,
            { headers: getAuthHeaders(token) }
        );
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        console.error("[API] Error marking consultation inquiry as read:", error);
        return NextResponse.json(
            { error: "Failed to mark consultation inquiry as read" },
            { status: 500 }
        );
    }
}
