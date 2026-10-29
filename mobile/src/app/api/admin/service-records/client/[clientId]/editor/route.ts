import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
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

        const response = await serverAPIClient.get(`/admin/service-records/client/${clientId}/editor`, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch service-record editor", "read");
    }
}
