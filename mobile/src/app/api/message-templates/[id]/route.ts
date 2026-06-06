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

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch message template");
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.patch(`/message-templates/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "update message template");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        const response = await serverAPIClient.delete(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete message template");
    }
}
