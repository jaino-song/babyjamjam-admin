import { NextRequest } from "next/server";

import { allowServiceRecordLinkRequest } from "@babyjamjam/shared/api";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    readJsonObjectBody,
    invalidJsonResponse,
    withNoStore,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse, validationProblemResponse } from "@/lib/api/problem-responses";

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

        const payload = allowServiceRecordLinkRequest("reset", await readJsonObjectBody(request));
        if ("pointer" in payload) {
            return validationProblemResponse("Invalid service record link selection", [
                { pointer: payload.pointer, code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "body" },
            ]);
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${scheduleId}/reset-link`,
            payload.body,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return invalidJsonResponse(error) ?? errorResponse(error, "reset service record link");
    }
}
