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
import { invalidClientIdResponse, isValidClientId } from "../client-route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// Mirrors backend UpdateClientDto: every field is @IsOptional, so this proxy
// only type-checks the known fields and passes everything else through to the
// backend's authoritative ValidationPipe.
const updateClientSchema = z
    .object({
        name: z.string(),
        primaryEmployeeId: z.number(),
        secondaryEmployeeId: z.number().nullable(),
        address: z.string().nullable(),
        phone: z.string().nullable(),
        type: z.string().nullable(),
        duration: z.number().nullable(),
        fullPrice: z.string().nullable(),
        grant: z.string().nullable(),
        actualPrice: z.string().nullable(),
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        careCenter: z.boolean(),
        voucherClient: z.boolean(),
        birthday: z.string().nullable(),
        dueDate: z.string().nullable(),
        serviceStatus: z.string().nullable(),
        breastPump: z.boolean(),
        eDocId: z.string().nullable(),
        areaId: z.string().nullable(),
    })
    .partial()
    .passthrough();

// GET /api/clients/[id] - Get a client by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        if (!isValidClientId(id)) {
            return invalidClientIdResponse();
        }

        const response = await serverAPIClient.get(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch client");
    }
}

// PATCH /api/clients/[id] - Update a client
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await params;
    if (!isValidClientId(id)) {
        return invalidClientIdResponse();
    }

    const { data, response } = await parseBody(updateClientSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.patch(`/clients/${id}`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "update client");
    }
}

// DELETE /api/clients/[id] - Delete a client
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        if (!isValidClientId(id)) {
            return invalidClientIdResponse();
        }

        const response = await serverAPIClient.delete(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete client");
    }
}
