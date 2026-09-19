import { NextRequest, NextResponse } from "next/server";

import { proxyLocalGetRequest } from "@/lib/api/route-utils";

/**
 * GET /api/eformsign-docs/document-id?documentId=abc123
 *
 * The upstream endpoint is application-authenticated and tenant-scoped. Keep
 * the query allowlist local to this route so the shared proxy cannot forward
 * unrelated request parameters.
 */
export async function GET(request: NextRequest) {
    const rawDocumentId = new URL(request.url).searchParams.get("documentId");
    const documentId = rawDocumentId?.trim();

    if (!documentId) {
        return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }

    const backendParams = new URLSearchParams({ documentId });
    return proxyLocalGetRequest(
        request,
        `/eformsign-docs/document-id?${backendParams.toString()}`,
        "fetch eformsign document mirror record",
    );
}
