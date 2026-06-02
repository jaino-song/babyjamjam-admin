import { NextRequest } from "next/server";
import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;

    return proxyPostRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}/re_request_outsider`,
        "re-request eformsign document",
    );
}
