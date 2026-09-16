import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value || null;
    if (!token) {
        return authRequiredResponse();
    }

    const { scheduleId } = await params;

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/reset-link`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        return errorResponse(error, "reset service record link");
    }
}
