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
        
        const limit = searchParams.get("limit");
        const offset = searchParams.get("offset");
        if (limit) params.limit = limit;
        if (offset) params.offset = offset;

        const response = await serverAPIClient.get("/notifications", {
            params,
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch notifications");
    }
}
