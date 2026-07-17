import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value || null;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { scheduleId } = await params;
    try {
        const response = await serverAPIClient.get(
            `/schedule-change-requests/schedules/${encodeURIComponent(scheduleId)}/preview`,
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
        console.error("[API] Error previewing service schedule change");
        return NextResponse.json({ error: "Failed to preview service schedule change" }, { status: 500 });
    }
}
