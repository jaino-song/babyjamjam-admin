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

import {
    invalidScheduleDateResponse,
    invalidScheduleIdResponse,
    isPositiveScheduleId,
    isValidIsoDate,
} from "../../../schedule-change-route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { scheduleId } = await params;
        if (!isPositiveScheduleId(scheduleId)) {
            return invalidScheduleIdResponse();
        }

        const body = await request.json().catch(() => null);
        const toDate = body && typeof body === "object"
            ? (body as { toDate?: unknown }).toDate
            : undefined;
        if (!isValidIsoDate(toDate)) {
            return invalidScheduleDateResponse();
        }

        const response = await serverAPIClient.post(
            `/schedule-change-requests/schedules/${scheduleId}/apply`,
            { toDate },
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "apply service schedule change");
    }
}
