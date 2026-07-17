import { NextRequest, NextResponse } from "next/server";

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

function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { scheduleId } = await params;
        if (!isPositiveIntegerString(scheduleId)) {
            return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
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
