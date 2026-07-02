import { NextRequest, NextResponse } from "next/server";
import { isAxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/schedule-change-requests/[id]/approve — admin approves a pending
// schedule change. Forwards the auth_token cookie as Bearer and PRESERVES the
// backend status/body (409 REQUEST_STALE etc. must reach the browser).
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/${encodeURIComponent(id)}/approve`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("approve schedule change request failed:", error);
        return NextResponse.json({ error: "Failed to approve schedule change request" }, { status: 500 });
    }
}
