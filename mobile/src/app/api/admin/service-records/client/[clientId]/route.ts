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

type RouteParams = { params: Promise<{ clientId: string }> };

function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

function invalidClientIdResponse() {
    return validationProblemResponse("Invalid client id", [
        { pointer: "/clientId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
    ]);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { clientId } = await params;
        if (!isPositiveIntegerString(clientId)) {
            return invalidClientIdResponse();
        }

        const caseIds = new URL(request.url).searchParams.getAll("caseId");
        if (caseIds.length > 1) {
            return validationProblemResponse("Invalid case selection", [{ pointer: "/caseId", code: "INVALID_FORMAT", detail: "아기 제공기록지 한 건을 선택해 주세요.", location: "query" }]);
        }
        const selection = caseIds.length ? `?caseId=${encodeURIComponent(caseIds[0])}` : "";
        const response = await serverAPIClient.get(`/admin/service-records/client/${clientId}${selection}`, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch client service records", "read");
    }
}
