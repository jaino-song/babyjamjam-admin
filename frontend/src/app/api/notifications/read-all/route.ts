import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function PATCH(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const response = await serverAPIClient.patch("/notifications/read-all", {}, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "mark notifications as read");
    }
}
