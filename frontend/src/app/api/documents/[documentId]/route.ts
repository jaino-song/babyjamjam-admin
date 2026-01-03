import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/app/lib/api/route-utils";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const { documentId } = await params;
    return proxyGetRequest(request, `/api/documents/${documentId}`, `fetch document ${documentId}`);
}
