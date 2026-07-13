import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

const ALLOWED_QUERY_KEYS = ["page", "limit", "search", "phone", "status", "readState"] as const;

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        for (const key of ALLOWED_QUERY_KEYS) {
            const value = searchParams.get(key);
            if (value !== null && value !== "") {
                params[key] = value;
            }
        }

        const response = await serverAPIClient.get("/consultation-inquiries", {
            params,
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch consultation inquiries");
    }
}
