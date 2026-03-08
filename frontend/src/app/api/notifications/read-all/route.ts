import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function PATCH(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.patch("/notifications/read-all", {}, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "mark notifications as read");
    }
}
