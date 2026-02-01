import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/app/lib/api/route-utils";

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, rejected)
 */
export async function GET(request: NextRequest) {
    return proxyGetRequest(request, "/api/documents", "fetch all eformsign documents");
}
