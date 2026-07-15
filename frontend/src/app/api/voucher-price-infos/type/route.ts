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
        
        const type = searchParams.get("type");
        const year = searchParams.get("year");
        if (type) params.type = type;
        if (year) params.year = year;

        const response = await serverAPIClient.get("/voucher-price-infos/type", {
            params,
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch voucher price infos by type");
    }
}
