import { NextRequest } from "next/server";

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

type RouteParams = { params: Promise<{ draftId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { draftId } = await params;

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post(
            `/admin/service-records/drafts/${encodeURIComponent(draftId)}/discard`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return errorResponse(error, "discard service record draft", "mutation");
    }
}
