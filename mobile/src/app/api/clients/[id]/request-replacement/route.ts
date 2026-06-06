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

// Mirrors backend RequestReplacementDto: `newPrimaryEmployeeId` is @IsInt
// (required); `newSecondaryEmployeeId` is @IsOptional @IsInt (nullable).
// Passthrough preserves any forward-compatible fields for the backend's
// authoritative ValidationPipe.
const requestReplacementSchema = z
    .object({
        newPrimaryEmployeeId: z.number(),
        newSecondaryEmployeeId: z.number().nullable().optional(),
    })
    .passthrough();

// PATCH /api/clients/[id]/request-replacement - Request employee replacement
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await params;
    if (!isValidClientId(id)) {
        return invalidClientIdResponse();
    }

    const { data, response } = await parseBody(requestReplacementSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(`/clients/${id}/request-replacement`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "request employee replacement");
    }
}
