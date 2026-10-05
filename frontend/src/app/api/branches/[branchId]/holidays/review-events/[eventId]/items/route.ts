import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string; eventId: string }>;
}

const PASS_THROUGH_QUERY = ["category", "status", "q"] as const;

// GET /api/branches/[branchId]/holidays/review-events/[eventId]/items — the
// clients affected by one holiday change. `category`, `status` and `q` are
// forwarded untouched; the backend validates them.
export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId, eventId } = await context.params;
        const params: Record<string, string> = {};
        for (const key of PASS_THROUGH_QUERY) {
            const value = request.nextUrl.searchParams.get(key);
            if (value !== null) params[key] = value;
        }
        const response = await serverAPIClient.get(
            `/branches/${encodeURIComponent(branchId)}/holidays/review-events/${encodeURIComponent(eventId)}/items`,
            { params, headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "read holiday review items", "read");
    }
}
