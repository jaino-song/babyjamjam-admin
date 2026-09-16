import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch current user", "read");
    }
}
