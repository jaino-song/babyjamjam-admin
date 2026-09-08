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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const { draftId } = await params;
    const body = await readJsonBody(request);

    try {
        const response = await serverAPIClient.patch(
            `/admin/service-records/drafts/${encodeURIComponent(draftId)}`,
            body ?? {},
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to save service record draft");
    }
}
