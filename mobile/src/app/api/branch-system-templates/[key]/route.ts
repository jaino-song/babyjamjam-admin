import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

function getExpectedBranchId(request: NextRequest): string | undefined {
    const value = request.nextUrl.searchParams.get("expectedBranchId")?.trim();
    return value || undefined;
}

// 모바일은 시스템 템플릿을 읽기만 한다. 지점 유효 본문 조회만 프록시하고
// 전역 수정(PUT)은 데스크톱 관리자 화면의 전용 경로로만 허용된다.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { key } = await params;
        const expectedBranchId = getExpectedBranchId(request);
        const response = await serverAPIClient.get(
            `/branch-system-templates/${encodeURIComponent(key)}`,
            {
                headers: getAuthHeaders(token),
                ...(expectedBranchId ? { params: { expectedBranchId } } : {}),
            },
        );
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch branch system template");
    }
}
