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
    withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

const patchDraftSchema = z.object({
    proposals: z
        .array(
            z.object({
                field: z.string(),
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
                evidence: z.string(),
                confidence: z.enum(["high", "low"]),
            }),
        )
        .optional(),
    clientId: z.number().int().nullable().optional(),
});

// GET /api/client-drafts/[id] - 클라이언트 초안 detail
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { id } = await params;

        const response = await serverAPIClient.get(
            `/client-drafts/${encodeURIComponent(id)}`,
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch client draft");
    }
}

// PATCH /api/client-drafts/[id] - 초안 수정
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedResponse("Unauthorized");

    const { id } = await params;

    const { data, response } = await parseBody(patchDraftSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(
            `/client-drafts/${encodeURIComponent(id)}`,
            data,
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "update client draft");
    }
}
