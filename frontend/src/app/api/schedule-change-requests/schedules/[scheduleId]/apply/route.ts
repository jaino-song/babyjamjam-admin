import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ scheduleId: string }> };
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value || null;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestBody = await request.json().catch(() => ({}));
    const toDate = requestBody && typeof requestBody === "object"
        ? (requestBody as { toDate?: unknown }).toDate
        : undefined;
    if (!isValidIsoDate(toDate)) {
        return NextResponse.json({ error: "Invalid schedule date" }, { status: 400 });
    }

    const { scheduleId } = await params;
    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/schedules/${encodeURIComponent(scheduleId)}/apply`,
            { toDate },
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("[API] Error applying service schedule change");
        return NextResponse.json({ error: "Failed to apply service schedule change" }, { status: 500 });
    }
}
