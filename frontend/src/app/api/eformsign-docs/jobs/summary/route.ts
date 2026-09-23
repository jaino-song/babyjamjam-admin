import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    try {
        const response = await serverAPIClient.get("/eformsign-docs/jobs/summary", {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch eformsign document job summary", "read");
    }
}
