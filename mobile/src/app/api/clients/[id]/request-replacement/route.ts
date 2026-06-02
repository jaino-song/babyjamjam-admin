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
import { invalidClientIdResponse, isValidClientId } from "../../client-route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/clients/[id]/request-replacement - Request employee replacement
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
        const response = await serverAPIClient.patch(`/clients/${id}/request-replacement`, body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;

        return errorResponse(error, "request employee replacement");
    }
}
