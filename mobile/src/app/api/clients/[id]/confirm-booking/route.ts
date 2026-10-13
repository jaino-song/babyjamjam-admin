import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import { invalidClientIdResponse, isValidClientId } from "../../client-route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// The backend confirmBooking endpoint binds no @Body DTO — it ignores the
// request body entirely. This proxy still forwards whatever object body was
// sent, so an all-optional passthrough object accepts any JSON object (incl.
// `{}`) while parseBody still rejects malformed JSON with a 400.
const confirmBookingSchema = z.object({}).passthrough();

// PATCH /api/clients/[id]/confirm-booking - Confirm the booking (rule 고객-04)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
    }

    const { id } = await params;
    if (!isValidClientId(id)) {
        return invalidClientIdResponse();
    }

    const { data, response } = await parseBody(confirmBookingSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(`/clients/${id}/confirm-booking`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "confirm client booking", "mutation");
    }
}
