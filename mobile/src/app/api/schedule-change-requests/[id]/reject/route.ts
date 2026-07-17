import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

function isValidRequestId(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function getReason(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    const reason = (body as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : undefined;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { id } = await params;
        if (!isValidRequestId(id)) {
            return NextResponse.json({ error: "Invalid schedule change request id" }, { status: 400 });
        }

        const reason = getReason(await request.json().catch(() => null));
        const response = await serverAPIClient.post(
            `/schedule-change-requests/${encodeURIComponent(id)}/reject`,
            reason === undefined ? {} : { reason },
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "reject service schedule change");
    }
}
