import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/notifications/subscribe", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "subscribe to notifications", "mutation");
    }
}
