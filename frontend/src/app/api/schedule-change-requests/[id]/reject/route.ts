import { NextRequest, NextResponse } from "next/server";
import { isAxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/schedule-change-requests/[id]/reject — admin rejects a pending
// schedule change. Forwards the auth_token cookie as Bearer and PRESERVES the
// backend status/body so 409 codes reach the browser.
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    try {
        const response = await serverAPIClient.post(
            `/schedule-change-requests/${encodeURIComponent(id)}/reject`,
            body,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("reject schedule change request failed:", error);
        return NextResponse.json({ error: "Failed to reject schedule change request" }, { status: 500 });
    }
}
