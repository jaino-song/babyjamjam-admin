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

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const body = await readJsonObjectBody(request);

        const response = await serverAPIClient.post("/eformsign-docs/dispatch-headless", body, {
            headers: getAuthHeaders(token),
            // Headless dispatch can approach 90s when eformsign is slow to fire the SDK
            // success callback; keep the proxy above that ceiling.
            timeout: 180_000,
        });

        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;

        return errorResponse(error, "headless eformsign dispatch");
    }
}
