import { NextRequest } from "next/server";

import {
    getAuthHeaders,
    getAuthToken,
    jsonResponse,
    readJsonBody,
    serverAPIClient,
    upstreamError,
} from "@/app/api/admin/service-records/_lib/proxy";

type RouteParams = { params: Promise<{ revisionId: string; documentStateId: string }> };

function isExactRetryBody(body: Record<string, unknown>): body is { expectedGeneration: string } {
    const keys = Object.keys(body);
    return keys.length === 1
        && keys[0] === "expectedGeneration"
        && typeof body.expectedGeneration === "string"
        && body.expectedGeneration.trim().length > 0
        && body.expectedGeneration.length <= 128;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const body = await readJsonBody(request);
    if (!body || !isExactRetryBody(body)) {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const { revisionId, documentStateId } = await params;

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/revisions/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(documentStateId)}/retry`,
            { expectedGeneration: body.expectedGeneration },
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        return upstreamError(error, "Failed to retry service-record document");
    }
}
