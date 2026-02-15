import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getRefreshToken, setAuthCookies, unauthorizedResponse, errorResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime } = body;

        const refreshToken = getRefreshToken(request);
        if (!refreshToken) {
            return unauthorizedResponse("Refresh token not found. Please authenticate again.");
        }

        const response = await serverAPIClient.post("/auth/refresh-token", {
            executionTime,
            refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data;

        // Update tokens in httpOnly cookies
        const res = NextResponse.json({ success: true });
        return setAuthCookies(res, accessToken, newRefreshToken);
    } catch (error) {
        return errorResponse(error, "refresh access token");
    }
}
