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

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { scheduleId } = await params;
    try {
        const response = await serverAPIClient.get(
            `/schedule-change-requests/schedules/${encodeURIComponent(scheduleId)}/preview`,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "preview service schedule change");
    }
}
