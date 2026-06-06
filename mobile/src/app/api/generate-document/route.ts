import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAccessToken,
    getAuthHeaders,
    getAuthToken,
    getRefreshToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        const body = await readJsonObjectBody(request);
        const { contractData, clientId } = body;

        const accessToken = getAccessToken(request);
        const refreshToken = getRefreshToken(request);

        if (!accessToken || !refreshToken) {
            return unauthorizedResponse("Authentication required. Please authenticate first.");
        }

        const response = await serverAPIClient.post("/api/generate-document", {
            contractData,
            accessToken,
            refreshToken,
            clientId,
        }, {
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "generate document");
    }
}
