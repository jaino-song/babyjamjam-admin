import { NextRequest, NextResponse } from "next/server";
import {
    errorResponse,
    getAccessToken,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    proxyGetRequest,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, rejected)
 *
 * Query params:
 * - limit: number of documents to fetch (default: 100)
 * - skip: number of documents to skip for pagination (default: 0)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "100";
    const skip = searchParams.get("skip") || "0";

    return proxyGetRequest(
        request,
        `/api/documents?limit=${limit}&skip=${skip}`,
        "fetch all eformsign documents"
    );
}

export async function DELETE(request: NextRequest) {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    try {
        const { searchParams } = new URL(request.url);
        const isPermanent = searchParams.get("is_permanent") || "false";
        const body = await request.json().catch(() => ({}));

        const response = await serverAPIClient.delete("/api/documents", {
            params: {
                accessToken,
                is_permanent: isPermanent,
            },
            data: body,
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "delete eformsign documents");
    }
}
