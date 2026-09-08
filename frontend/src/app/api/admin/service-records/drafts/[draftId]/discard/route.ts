import { NextRequest } from "next/server";

import {
    getAuthHeaders,
    getAuthToken,
    jsonResponse,
    readJsonBody,
    serverAPIClient,
    upstreamError,
} from "@/app/api/admin/service-records/_lib/proxy";

type RouteParams = { params: Promise<{ draftId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const { draftId } = await params;
    const body = await readJsonBody(request);

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/drafts/${encodeURIComponent(draftId)}/discard`,
            body ?? {},
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to discard service record draft");
    }
}
