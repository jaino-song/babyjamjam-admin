import { NextRequest } from "next/server";
import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

// BJJ-439 계약 파기. The backend endpoint takes no body, so there is no body schema; status and
// problem body pass through so the card can tell a 409 (stale card) from an uncertain failure.
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;

    return proxyPostRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}/void`,
        "void eformsign document",
    );
}
