import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { jsonResponse } from "@/app/api/admin/service-records/_lib/proxy";
import { pickServiceRecordScheduleErrorExtension } from "@/features/service-records/types/admin-edit";

type RouteParams = { params: Promise<{ draftId: string }> };

/**
 * The shared problem sanitizer drops members it does not know. A schedule
 * replacement is refused with a `scheduleCode` (and a locked-session conflict
 * with `blockingReasons`) that the dialog needs to explain what to change, so
 * both are re-attached after validating them down to a closed code set.
 */
async function withScheduleErrorExtension(response: NextResponse, error: unknown): Promise<NextResponse> {
    const extension = pickServiceRecordScheduleErrorExtension(error);
    if (!extension) return response;
    const body = await response.json().catch(() => ({}));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return NextResponse.json(
        { ...(typeof body === "object" && body !== null ? body : {}), ...extension },
        { status: response.status, headers },
    );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { draftId } = await params;

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.patch(
            `/admin/service-records/drafts/${encodeURIComponent(draftId)}`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return withScheduleErrorExtension(errorResponse(error, "save service record draft"), error);
    }
}
