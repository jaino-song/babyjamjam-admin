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

import { invalidScheduleIdResponse, isPositiveScheduleId } from "../../../schedule-change-route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { scheduleId } = await params;
        if (!isPositiveScheduleId(scheduleId)) {
            return invalidScheduleIdResponse();
        }

        const response = await serverAPIClient.get(
            `/schedule-change-requests/schedules/${scheduleId}/preview`,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "preview service schedule change");
    }
}
