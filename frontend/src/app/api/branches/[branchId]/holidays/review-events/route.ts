import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string }>;
}

// GET /api/branches/[branchId]/holidays/review-events — holiday changes that
// still have clients whose end date needs a look. Backend problem+json passes
// through errorResponse.
export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId } = await context.params;
        const response = await serverAPIClient.get(
            `/branches/${encodeURIComponent(branchId)}/holidays/review-events`,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "read holiday review events", "read");
    }
}
