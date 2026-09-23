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

// POST /api/schedule-change-requests/[id]/reject — admin rejects a pending
// schedule change. Forwards the auth_token cookie as Bearer and PRESERVES the
// backend status/body so 409 codes reach the browser.
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const body = await request.json().catch(() => ({}));
    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/${encodeURIComponent(id)}/reject`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "reject schedule change request");
    }
}
