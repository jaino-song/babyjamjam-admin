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

import { invalidScheduleDateResponse, isValidIsoDate } from "../../../schedule-change-route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const requestBody = await request.json().catch(() => ({}));
    const toDate = requestBody && typeof requestBody === "object"
        ? (requestBody as { toDate?: unknown }).toDate
        : undefined;
    if (!isValidIsoDate(toDate)) {
        return invalidScheduleDateResponse();
    }

    const { scheduleId } = await params;
    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/schedules/${encodeURIComponent(scheduleId)}/apply`,
            { toDate },
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "apply service schedule change");
    }
}
