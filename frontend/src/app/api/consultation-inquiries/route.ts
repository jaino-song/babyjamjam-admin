import { NextRequest, NextResponse } from "next/server";

import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};

        for (const key of ["page", "limit", "search", "status"]) {
            const value = searchParams.get(key);
            if (value) params[key] = value;
        }

        const response = await serverAPIClient.get("/consultation-inquiries", {
            params,
            headers: getAuthHeaders(token),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "fetch consultation inquiries");
    }
}
