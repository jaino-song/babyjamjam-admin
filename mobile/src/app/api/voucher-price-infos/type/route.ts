import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

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

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        
        const type = searchParams.get("type");
        const year = searchParams.get("year");
        if (type) params.type = type;
        if (year) params.year = year;

        const response = await serverAPIClient.get("/voucher-price-infos/type", {
            params,
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[API] Error fetching voucher price infos by type:", error.message);
        return NextResponse.json(
            { error: "Failed to fetch voucher price infos" },
            { status: error.response?.status || 500 }
        );
    }
}
