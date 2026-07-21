import { NextRequest, NextResponse } from "next/server";
import { proxyGetRequest } from "@/app/lib/api/route-utils";

const DOCUMENT_ID_PATTERN = /^[a-f0-9]{32}$/i;

export async function GET(request: NextRequest) {
    const documentId = request.nextUrl.searchParams.get("documentId");

    if (!documentId || !DOCUMENT_ID_PATTERN.test(documentId)) {
        return NextResponse.json({ error: "Valid documentId is required" }, { status: 400 });
    }

    return proxyGetRequest(request, `/api/documents/${documentId}`, `fetch document ${documentId}`);
}
