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
const PREPARED_LINK_TOKEN_PATTERN = /^efl_[A-Za-z0-9_-]{40,64}$/;
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
        return errorResponse(error, "send service record link");
    }
    const preparedLinkToken = requestBody.preparedLinkToken;
    const recipientPhone = requestBody.recipientPhone;
    if (
        preparedLinkToken !== undefined
        && (typeof preparedLinkToken !== "string" || !PREPARED_LINK_TOKEN_PATTERN.test(preparedLinkToken))
    ) {
        return localValidationProblemResponse([
            { pointer: "/preparedLinkToken", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" },
        ]);
    }
    if (
        recipientPhone !== undefined
        && (typeof recipientPhone !== "string" || !RECIPIENT_PHONE_PATTERN.test(recipientPhone))
    ) {
        return localValidationProblemResponse([
            { pointer: "/recipientPhone", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" },
        ]);
    }

    try {
        const body = {
            ...(preparedLinkToken ? { preparedLinkToken } : {}),
            ...(recipientPhone ? { recipientPhone } : {}),
        };
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/send-link`,
            body,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        return errorResponse(error, "send service record link");
    }
}
