import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/notifications/unsubscribe", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "unsubscribe from notifications");
    }
}
