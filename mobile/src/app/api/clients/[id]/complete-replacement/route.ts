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
import { invalidClientIdResponse, isValidClientId } from "../../client-route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// The backend completeReplacement endpoint binds no @Body DTO — it ignores the
// request body entirely. This proxy still forwards whatever object body was
// sent, so an all-optional passthrough object accepts any JSON object (incl.
// `{}`) while parseBody still rejects malformed JSON with a 400.
const completeReplacementSchema = z.object({}).passthrough();

// PATCH /api/clients/[id]/complete-replacement - Complete employee replacement
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await params;
    if (!isValidClientId(id)) {
        return invalidClientIdResponse();
    }

    const { data, response } = await parseBody(completeReplacementSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(`/clients/${id}/complete-replacement`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "complete employee replacement");
    }
}
