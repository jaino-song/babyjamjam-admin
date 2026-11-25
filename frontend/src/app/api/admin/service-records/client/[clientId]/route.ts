import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    localValidationProblemResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    const { clientId } = await params;

    try {
        const caseIds = new URL(request.url).searchParams.getAll("caseId");
        if (caseIds.length > 1) {
            return localValidationProblemResponse([{ pointer: "/caseId", code: "INVALID_FORMAT", detail: "아기 제공기록지 한 건을 선택해 주세요.", location: "query" }]);
        }
        const selection = caseIds.length ? `?caseId=${encodeURIComponent(caseIds[0])}` : "";
        const response = await serverAPIClient.get(
            `/admin/service-records/client/${encodeURIComponent(clientId)}${selection}`,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return errorResponse(error, "fetch service records", "read");
    }
}
