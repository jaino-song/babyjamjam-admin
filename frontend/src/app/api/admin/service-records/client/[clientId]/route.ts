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
    if (!token) {
        return authRequiredResponse();
    }

    const { clientId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/client/${encodeURIComponent(clientId)}`,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        return errorResponse(error, "fetch service records", "read");
    }
}
