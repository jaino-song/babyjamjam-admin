import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    invalidJsonResponse,
    localValidationProblemResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };
const RECIPIENT_PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value || null;
    if (!token) {
        return authRequiredResponse();
    }

    const { scheduleId } = await params;

    let requestBody: Record<string, unknown>;
    try {
        requestBody = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return errorResponse(error, "prepare service record link");
    }
    const recipientPhone = requestBody.recipientPhone;
    if (
        recipientPhone !== undefined
        && (typeof recipientPhone !== "string" || !RECIPIENT_PHONE_PATTERN.test(recipientPhone))
    ) {
        return localValidationProblemResponse([
            { pointer: "/recipientPhone", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" },
        ]);
    }

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/prepare-link`,
            recipientPhone ? { recipientPhone } : {},
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        return errorResponse(error, "prepare service record link");
    }
}
