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

import { invalidScheduleIdResponse, isPositiveScheduleId } from "../../link-route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedProblemResponse();

        const { scheduleId } = await params;
        if (!isPositiveScheduleId(scheduleId)) {
            return invalidScheduleIdResponse();
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${scheduleId}/reset-link`,
            {},
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "reset service record link");
    }
}
