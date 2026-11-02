import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    withNoStore,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

import { invalidClientIdResponse, isPositiveIntegerString } from "../../../_lib/route-params";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedProblemResponse();

        const { clientId } = await params;
        if (!isPositiveIntegerString(clientId)) return invalidClientIdResponse();

        const response = await serverAPIClient.get(`/admin/service-records/client/${clientId}/draft`, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch service record draft", "read");
    }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedProblemResponse();

    const { clientId } = await params;
    if (!isPositiveIntegerString(clientId)) return invalidClientIdResponse();

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post(`/admin/service-records/client/${clientId}/draft`, body, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return errorResponse(error, "start service record draft", "mutation");
    }
}
