import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

import { invalidScheduleIdResponse, isPositiveScheduleId } from "../../link-route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { scheduleId } = await params;
        if (!isPositiveScheduleId(scheduleId)) {
            return invalidScheduleIdResponse();
        }

        // A malformed JSON body is rejected before proxying instead of being
        // silently forwarded as `{}` (which would mask the client bug).
        let body: Record<string, unknown>;
        try {
            body = await readJsonObjectBody(request);
        } catch (error) {
            return invalidJsonResponse(error)
                ?? validationProblemResponse("Request body must be valid JSON", [
                    { pointer: "", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "body" },
                ]);
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "send service record link");
    }
}
