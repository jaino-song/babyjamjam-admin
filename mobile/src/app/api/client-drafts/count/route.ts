import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    withNoStore,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

// GET /api/client-drafts/count — 초안 건수 (status)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedProblemResponse();

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        const status = searchParams.get("status");
        if (status) params.status = status;

        const response = await serverAPIClient.get("/client-drafts/count", {
            params,
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "count client drafts");
    }
}
