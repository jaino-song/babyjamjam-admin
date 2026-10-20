import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";
import { jsonResponse } from "@/app/api/admin/service-records/_lib/proxy";

type RouteParams = { params: Promise<{ clientId: string; revisionId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { clientId, revisionId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/clients/${encodeURIComponent(clientId)}/revisions/${encodeURIComponent(revisionId)}/changes`,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return errorResponse(error, "fetch service-record revision changes", "read");
    }
}
