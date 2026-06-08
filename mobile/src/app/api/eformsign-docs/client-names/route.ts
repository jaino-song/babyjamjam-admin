import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        const response = await serverAPIClient.get("/eformsign-docs/client-names", {
            headers: getAuthHeaders(token),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "fetch eformsign document client names");
    }
}
