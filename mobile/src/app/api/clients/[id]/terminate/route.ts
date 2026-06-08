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

// Mirrors backend TerminateServiceDto: `reason` is @IsOptional @IsString, so
// the body is all-optional. Type-check the known field; passthrough preserves
// any forward-compatible fields for the backend's authoritative ValidationPipe.
const terminateServiceSchema = z
    .object({
        reason: z.string(),
    })
    .partial()
    .passthrough();

// PATCH /api/clients/[id]/terminate - Terminate client service
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await params;
    if (!isValidClientId(id)) {
        return invalidClientIdResponse();
    }

    const { data, response } = await parseBody(terminateServiceSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(`/clients/${id}/terminate`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "terminate client service");
    }
}
