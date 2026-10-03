import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string; id: string }>;
}

// DELETE /api/branches/[branchId]/holidays/overrides/[id] — remove one branch
// override (restores an excluded date, or deletes a branch-added one).
export async function DELETE(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId, id } = await context.params;
        const response = await serverAPIClient.delete(
            `/branches/${encodeURIComponent(branchId)}/holidays/overrides/${encodeURIComponent(id)}`,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "delete branch holiday override", "mutation");
    }
}
