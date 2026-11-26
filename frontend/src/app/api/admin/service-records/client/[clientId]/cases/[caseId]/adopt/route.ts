import { NextRequest } from "next/server";

import { jsonResponse } from "@/app/api/admin/service-records/_lib/proxy";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    localValidationProblemResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ clientId: string; caseId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { clientId, caseId } = await params;

    const invalidParam = !/^[1-9]\d*$/.test(clientId) || !Number.isSafeInteger(Number(clientId))
        ? "clientId" : !UUID.test(caseId) ? "caseId" : null;
    if (invalidParam) {
        return localValidationProblemResponse([
            { pointer: `/${invalidParam}`, code: "INVALID_FORMAT", detail: "고객 또는 기록지 정보가 올바르지 않아요.", location: "path" },
        ]);
    }
    if (request.nextUrl.search) {
        return localValidationProblemResponse([
            { pointer: "/", code: "INVALID_FORMAT", detail: "검색 조건 없이 요청해 주세요.", location: "query" },
        ]);
    }

    try {
        const body = await readJsonObjectBody(request);
        if (Object.keys(body).length !== 1 || typeof body.babyId !== "string" || !UUID.test(body.babyId)) {
            return localValidationProblemResponse([
                { pointer: "/babyId", code: "INVALID_FORMAT", detail: "연결할 아기 한 명을 선택해 주세요.", location: "body" },
            ]);
        }
        // The session token carries the selected branch.
        const response = await serverAPIClient.post(
            `/admin/service-records/client/${clientId}/cases/${caseId}/adopt`,
            { babyId: body.babyId },
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data, response.status);
    } catch (error) {
        return invalidJsonResponse(error) ?? errorResponse(error, "adopt legacy service record case", "mutation");
    }
}
