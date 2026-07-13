import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

// GET /api/client-drafts — 클라이언트 초안 list (status/page/limit)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        for (const key of ["status", "page", "limit"]) {
            const value = searchParams.get(key);
            if (value) params[key] = value;
        }

        const response = await serverAPIClient.get("/client-drafts", {
            params,
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch client drafts");
    }
}
