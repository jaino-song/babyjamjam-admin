import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    withNoStore,
    invalidJsonResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse, validationProblemResponse } from "@/lib/api/problem-responses";

import { invalidClientIdResponse, isPositiveIntegerString } from "../../../../_lib/route-params";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedProblemResponse();
    const { clientId } = await params;
    if (!isPositiveIntegerString(clientId)) return invalidClientIdResponse();

    try {
        const body = await readJsonObjectBody(request);
        const indexes = body.sessionIndexes;
        if (!Array.isArray(indexes) || indexes.length === 0
            || !indexes.every((index) => Number.isInteger(index) && index >= 1)
            || new Set(indexes).size !== indexes.length) {
            return validationProblemResponse("Invalid session indexes", [
                { pointer: "/sessionIndexes", code: "INVALID_VALUE", detail: "입력값을 확인해 주세요.", location: "body" },
            ]);
        }
        const response = await serverAPIClient.post(`/admin/service-records/client/${clientId}/period-mismatch/keep`, { sessionIndexes: indexes }, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return errorResponse(error, "keep service record period mismatch", "mutation");
    }
}
