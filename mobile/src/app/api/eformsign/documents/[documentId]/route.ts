import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/lib/api/route-utils";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const { documentId } = await params;

    return proxyGetRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}`,
        "fetch eformsign document detail"
    );
}
