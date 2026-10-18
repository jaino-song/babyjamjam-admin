import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/clients/[id]/confirm-booking - Confirm the stored booking dates
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return authRequiredResponse();

        const { id } = await params;
        const response = await serverAPIClient.patch(`/clients/${id}/confirm-booking`, {}, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "confirm booking", "mutation");
    }
}
