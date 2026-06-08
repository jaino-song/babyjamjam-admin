import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
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
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch voucher price infos");
    }
}
