import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import { invalidClientIdResponse, isValidClientId } from "../client-route-utils";

type RouteParams = { params: Promise<{ id: string }> };

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
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        if (!isValidClientId(id)) {
            return invalidClientIdResponse();
        }

        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.patch(`/clients/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;

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
