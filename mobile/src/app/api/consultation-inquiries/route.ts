import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

const ALLOWED_QUERY_KEYS = ["page", "limit", "search", "phone", "status", "readState"] as const;

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        for (const key of ALLOWED_QUERY_KEYS) {
            const value = searchParams.get(key);
            if (value !== null && value !== "") {
                params[key] = value;
            }
        }

        const response = await serverAPIClient.get("/consultation-inquiries", {
            params,
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        console.error("[API] Error fetching consultation inquiries:", error);
        return NextResponse.json(
            { error: "Failed to fetch consultation inquiries" },
            { status: 500 }
        );
    }
}
