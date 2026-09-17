import { NextRequest, NextResponse } from "next/server";

import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        const response = await serverAPIClient.patch(`/notifications/${id}/read`, {}, {
            headers: getAuthHeaders(token),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "mark notification as read");
    }
}
