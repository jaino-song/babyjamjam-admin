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

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/call-records/[id] - 통화 기록 detail
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedProblemResponse();

        const { id } = await params;

        const response = await serverAPIClient.get(
            `/call-records/${encodeURIComponent(id)}`,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch call record");
    }
}
