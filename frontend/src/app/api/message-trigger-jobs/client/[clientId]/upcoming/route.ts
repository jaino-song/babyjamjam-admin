import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();

    const { clientId } = await params;
    const limit = request.nextUrl.searchParams.get("limit");
    const cursor = request.nextUrl.searchParams.get("cursor");

    try {
        const response = await serverAPIClient.get(
            `/message-trigger-jobs/client/${encodeURIComponent(clientId)}/upcoming`,
            {
                headers: getAuthHeaders(token),
                params: {
                    ...(limit ? { limit } : {}),
                    ...(cursor ? { cursor } : {}),
                },
            },
        );

        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        return errorResponse(error, "fetch client upcoming message trigger jobs", "read");
    }
}
