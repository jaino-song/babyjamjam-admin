import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

function invalidScheduleIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { scheduleId } = await params;
        if (!isPositiveIntegerString(scheduleId)) {
            return invalidScheduleIdResponse();
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            {},
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "send service record link");
    }
}
