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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

function isValidIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { scheduleId } = await params;
        if (!isPositiveIntegerString(scheduleId)) {
            return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
        }

        const body = await request.json().catch(() => null);
        const toDate = body && typeof body === "object"
            ? (body as { toDate?: unknown }).toDate
            : undefined;
        if (!isValidIsoDate(toDate)) {
            return NextResponse.json({ error: "Invalid schedule date" }, { status: 400 });
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
