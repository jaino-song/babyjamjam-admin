import { NextRequest } from "next/server";
import { proxyDeleteRequest, proxyGetRequest } from "@/lib/api/route-utils";

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

/**
 * DELETE /api/eformsign/documents
 * Delete one or more eformsign documents
 */
export async function DELETE(request: NextRequest) {
    return proxyDeleteRequest(request, "/api/documents", "delete eformsign documents");
}
