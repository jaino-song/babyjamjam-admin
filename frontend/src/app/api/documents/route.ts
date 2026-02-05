import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/app/lib/api/route-utils";

/**
 * GET /api/documents
 * Proxy to eformsign documents API (for contracts page)
 */
export async function GET(request: NextRequest) {
    return proxyGetRequest(request, "/api/documents", "fetch documents");
}
