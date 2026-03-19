import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { E2E_AUTH_USER, isE2ETest } from "@/lib/e2e";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(request: NextRequest) {
    try {
        if (isE2ETest()) {
            return NextResponse.json(E2E_AUTH_USER);
        }

        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        
        return NextResponse.json(response.data);
    } catch (error: unknown) {
        const err = error as { message?: string; response?: { status?: number; data?: { message?: string } } };
        console.error("[API] Error fetching current user:", err.message);
        const status = err.response?.status || 500;
        const message = err.response?.data?.message || "Failed to fetch user";
        return NextResponse.json({ error: message }, { status });
    }
}
