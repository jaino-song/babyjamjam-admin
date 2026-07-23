import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ scheduleId: string }> };
const RECIPIENT_PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { scheduleId } = await params;
    const requestBody = await request.json().catch(() => ({}));
    const recipientPhone = requestBody && typeof requestBody === "object"
        ? (requestBody as { recipientPhone?: unknown }).recipientPhone
        : undefined;
    if (
        recipientPhone !== undefined
        && (typeof recipientPhone !== "string" || !RECIPIENT_PHONE_PATTERN.test(recipientPhone))
    ) {
        return NextResponse.json({ error: "Invalid recipient phone" }, { status: 400 });
    }

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/prepare-link`,
            recipientPhone ? { recipientPhone } : {},
            { headers: getAuthHeaders(token) },
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
        console.error("[API] Error preparing service record link");
        return NextResponse.json({ error: "Failed to prepare service record link" }, { status: 500 });
    }
}
