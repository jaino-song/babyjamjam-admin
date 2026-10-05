import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

interface RouteContext {
    params: Promise<{ branchId: string; eventId: string }>;
}

// POST /api/branches/[branchId]/holidays/review-events/[eventId]/resolve — fix
// or keep the selected clients' end dates. The backend validates the body and
// answers per item; its problem+json passes through.
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { branchId, eventId } = await context.params;
        const body: unknown = await request.json();
        const response = await serverAPIClient.post(
            `/branches/${encodeURIComponent(branchId)}/holidays/review-events/${encodeURIComponent(eventId)}/resolve`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "resolve holiday review items", "mutation");
    }
}
