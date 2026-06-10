import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

const discardDraftSchema = z.object({
    reason: z.string().max(1000).optional(),
});

// POST /api/client-drafts/[id]/discard - 초안 폐기
export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedResponse("Unauthorized");

    const { id } = await params;

    const { data, response } = await parseBody(discardDraftSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.post(
            `/client-drafts/${encodeURIComponent(id)}/discard`,
            data,
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "discard client draft");
    }
}
