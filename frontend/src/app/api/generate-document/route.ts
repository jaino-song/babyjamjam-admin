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
        if (!Number.isInteger(clientId) || Number(clientId) < 1) {
            return NextResponse.json({ error: "clientId is required" }, { status: 400 });
        }

        const accessToken = getAccessToken(request);
        const refreshToken = getRefreshToken(request);

        if (!accessToken || !refreshToken) {
            return unauthorizedResponse("Authentication required. Please authenticate first.");
        }

        const response = await serverAPIClient.post("/api/generate-document", {
            contractData,
            accessToken,
            refreshToken,
            clientId: Number(clientId),
        }, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        return NextResponse.json(response.data);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "generate document");
    }
}
