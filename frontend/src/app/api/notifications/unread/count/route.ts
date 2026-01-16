import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/notifications/unread/count", {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[API] Error fetching unread count:", error.message);
        return NextResponse.json(
            { error: "Failed to fetch unread count" },
            { status: error.response?.status || 500 }
        );
    }
}
