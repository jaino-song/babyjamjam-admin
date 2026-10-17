import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;
    const token = getAuthToken(request);
    if (!token) return unauthorizedResponse("Authentication required. Please log in.");
    try {
        // proxyPostRequest always sends an object body; this endpoint is bodyless.
        const response = await serverAPIClient.post(
            `/api/documents/${encodeURIComponent(documentId)}/void`,
            undefined,
            { headers: getAuthHeaders(token) },
        );
        if ((response.status ?? 200) >= 400) {
            return errorResponse({ response }, "void eformsign document", "mutation");
        }
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "void eformsign document");
    }
}
