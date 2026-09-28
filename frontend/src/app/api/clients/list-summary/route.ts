import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const search = request.nextUrl.searchParams.get("search");
        const response = await serverAPIClient.get("/clients/list-summary", {
            params: search === null ? {} : { search },
            headers: getAuthHeaders(token),
        });

        return NextResponse.json(response.data, { status: response.status ?? 200 });
    } catch (error) {
        return errorResponse(error, "fetch client list summary", "read");
    }
}
