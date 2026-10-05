import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string }>;
}

// POST /api/branches/[branchId]/holidays/overrides — add or exclude one date for
// this branch. The backend validates the body; its problem+json passes through.
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId } = await context.params;
        const body: unknown = await request.json();
        const response = await serverAPIClient.post(
            `/branches/${encodeURIComponent(branchId)}/holidays/overrides`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "create branch holiday override", "mutation");
    }
}
