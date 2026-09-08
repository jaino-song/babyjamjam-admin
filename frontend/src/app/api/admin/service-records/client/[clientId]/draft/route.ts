import { NextRequest } from "next/server";

import {
    getAuthHeaders,
    getAuthToken,
    jsonResponse,
    readJsonBody,
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
            `/admin/service-records/client/${encodeURIComponent(clientId)}/draft`,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to fetch service record draft");
    }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const { clientId } = await params;
    const body = await readJsonBody(request);

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/client/${encodeURIComponent(clientId)}/draft`,
            body ?? {},
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to start service record draft");
    }
}
