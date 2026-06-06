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

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.get("/settings/alimtalk-provider", {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch alimtalk provider");
    }
}

export async function PUT(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.put("/settings/alimtalk-provider", body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "update alimtalk provider");
    }
}
