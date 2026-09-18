import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ clientId: string }> };

function jsonResponse(body: unknown, status: number): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    const { clientId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/client/${encodeURIComponent(clientId)}/editor`,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return errorResponse(error, "fetch service-record editor", "read");
    }
}
