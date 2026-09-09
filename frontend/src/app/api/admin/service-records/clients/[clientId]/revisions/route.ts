import { NextRequest } from "next/server";

import {
    getAuthHeaders,
    getAuthToken,
    jsonResponse,
    serverAPIClient,
    upstreamError,
} from "@/app/api/admin/service-records/_lib/proxy";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const { clientId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/clients/${encodeURIComponent(clientId)}/revisions`,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to fetch service-record revision history");
    }
}
