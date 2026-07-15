import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        
        const limit = searchParams.get("limit");
        const offset = searchParams.get("offset");
        if (limit) params.limit = limit;
        if (offset) params.offset = offset;

        const response = await serverAPIClient.get("/notifications", {
            params,
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch notifications");
    }
}
