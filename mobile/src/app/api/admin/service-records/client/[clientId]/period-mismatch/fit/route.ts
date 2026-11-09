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

import { invalidClientIdResponse, isPositiveIntegerString } from "../../../../_lib/route-params";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedProblemResponse();
    const { clientId } = await params;
    if (!isPositiveIntegerString(clientId)) return invalidClientIdResponse();

    try {
        const response = await serverAPIClient.post(`/admin/service-records/client/${clientId}/period-mismatch/fit`, {}, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fit service record period mismatch", "mutation");
    }
}
