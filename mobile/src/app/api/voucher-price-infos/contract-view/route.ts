import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const year = request.nextUrl.searchParams.get("year");
        const response = await serverAPIClient.get("/voucher-price-infos/contract-view", {
            params: year ? { year } : undefined,
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch contract voucher price infos");
    }
}
