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
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { key } = await params;
        const response = await serverAPIClient.get(`/system-templates/${key}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch system template");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { key } = await params;
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.put(`/system-templates/${key}`, body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "update system template");
    }
}
