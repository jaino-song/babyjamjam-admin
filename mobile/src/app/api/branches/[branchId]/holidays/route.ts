import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

interface RouteContext {
    params: Promise<{ branchId: string }>;
}

// GET /api/branches/[branchId]/holidays?year=YYYY — one year of the branch's
// effective holiday list. `year` is forwarded untouched; the backend validates
// it and its problem+json status/code pass through errorResponse.
export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { branchId } = await context.params;
        const year = request.nextUrl.searchParams.get("year");
        const response = await serverAPIClient.get(`/branches/${encodeURIComponent(branchId)}/holidays`, {
            params: year === null ? undefined : { year },
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "read branch holidays", "read");
    }
}
