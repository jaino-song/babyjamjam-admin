import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
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
        const { executionTime } = body;

        const response = await serverAPIClient.post("/api/generate-signature", {
            executionTime,
        }, {
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "generate signature");
    }
}
