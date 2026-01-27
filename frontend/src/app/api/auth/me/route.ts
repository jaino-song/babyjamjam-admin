import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        
        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[API] Error fetching current user:", error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || "Failed to fetch user";
        return NextResponse.json({ error: message }, { status });
    }
}
