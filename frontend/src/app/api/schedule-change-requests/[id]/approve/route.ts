import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/schedule-change-requests/[id]/approve — admin approves a pending
// schedule change. Forwards the auth_token cookie as Bearer and PRESERVES the
// backend status/body (409 REQUEST_STALE etc. must reach the browser).
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/${encodeURIComponent(id)}/approve`,
            {},
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "approve schedule change request");
    }
}
