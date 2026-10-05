import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string }>;
}

// POST /api/branches/[branchId]/holidays/sync — pull the public-holiday data
// now. No request body; the backend rate-limits it (429 passes through).
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId } = await context.params;
        const response = await serverAPIClient.post(
            `/branches/${encodeURIComponent(branchId)}/holidays/sync`,
            undefined,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "sync branch holidays", "mutation");
    }
}
