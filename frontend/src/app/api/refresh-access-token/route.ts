import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { getRefreshToken, setAuthCookies, unauthorizedResponse, errorResponse } from "@/app/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime } = body;

        const refreshToken = getRefreshToken(request);
        if (!refreshToken) {
            return unauthorizedResponse("Refresh token not found. Please authenticate again.");
        }

        const response = await serverAPIClient.post("/api/refresh-token", {
            executionTime,
            refreshToken,
        });

        const { oauth_token } = response.data;

        // Update tokens in httpOnly cookies
        const res = NextResponse.json({ success: true });
        return setAuthCookies(res, oauth_token.access_token, oauth_token.refresh_token);
    } catch (error) {
        return errorResponse(error, "refresh access token");
    }
}
