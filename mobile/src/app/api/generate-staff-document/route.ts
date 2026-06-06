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
    sanitizeUpstreamClientError,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        const body = await readJsonObjectBody(request);
        const accessToken =
            typeof body.accessToken === "string" && body.accessToken
                ? body.accessToken
                : getAccessToken(request);
        const refreshToken =
            typeof body.refreshToken === "string" && body.refreshToken
                ? body.refreshToken
                : getRefreshToken(request);

        if (!body.documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        if (!accessToken || !refreshToken) {
            return unauthorizedResponse("Authentication required. Please authenticate first.");
        }

        const response = await serverAPIClient.post("/api/generate-staff-document", {
            documentId: body.documentId,
            accessToken,
            refreshToken,
            prefillEndDate: body.prefillEndDate,
        }, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to generate staff document"),
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "generate staff document");
    }
}
