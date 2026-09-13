import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// 모바일은 시스템 템플릿을 읽기만 한다. 지점 유효 카탈로그 조회만
// 프록시하고 전역 수정 경로는 노출하지 않는다 (편집은 데스크톱 전용).
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const expectedBranchId = request.nextUrl.searchParams.get("expectedBranchId")?.trim();
        const response = await serverAPIClient.get("/branch-system-templates", {
            headers: getAuthHeaders(token),
            ...(expectedBranchId ? { params: { expectedBranchId } } : {}),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch branch system templates");
    }
}
