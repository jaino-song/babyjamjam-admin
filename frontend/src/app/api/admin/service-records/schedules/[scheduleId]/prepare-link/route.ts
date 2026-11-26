import { NextRequest, NextResponse } from "next/server";

import { allowServiceRecordLinkRequest } from "@babyjamjam/shared/api";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    invalidJsonResponse,
    localValidationProblemResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value || null;
    if (!token) {
        return authRequiredResponse();
    }

    const { scheduleId } = await params;

    try {
        const payload = allowServiceRecordLinkRequest("prepare", await readJsonObjectBody(request));
        if ("pointer" in payload) {
            return localValidationProblemResponse([
                { pointer: payload.pointer, code: "INVALID_FORMAT", detail: "Invalid input", location: "body" },
            ]);
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/prepare-link`,
            payload.body,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        return invalidJsonResponse(error) ?? errorResponse(error, "prepare service record link");
    }
}
