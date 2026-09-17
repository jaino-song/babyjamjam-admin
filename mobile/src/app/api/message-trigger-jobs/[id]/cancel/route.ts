import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    withNoStore,
} from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

type RouteParams = { params: Promise<{ id: string }> };

function isValidJobId(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedProblemResponse();

        const { id } = await params;
        if (!isValidJobId(id)) {
            return validationProblemResponse("Invalid message trigger job id", [
                { pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
            ]);
        }

        const response = await serverAPIClient.post(
            `/message-trigger-jobs/${encodeURIComponent(id)}/cancel`,
            {},
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "cancel message trigger job");
    }
}
