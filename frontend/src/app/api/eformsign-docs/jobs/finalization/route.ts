import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post("/eformsign-docs/jobs/finalization", body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return invalidJsonResponse(error) ?? errorResponse(error, "enqueue eformsign document finalization", "mutation");
    }
}
