import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    getRefreshToken,
    setAuthCookies,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        const body = await request.json();
        const { executionTime } = body;

        const refreshToken = getRefreshToken(request);
        if (!refreshToken) {
            return unauthorizedResponse("Refresh token not found. Please authenticate again.");
        }

        const response = await serverAPIClient.post("/api/refresh-token", {
            executionTime,
            refreshToken,
        }, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        if (!accessToken || !newRefreshToken) {
            return NextResponse.json(
                { error: "Invalid response from refresh service" },
                { status: 500 },
            );
        }

        const res = NextResponse.json({ success: true });
        return setAuthCookies(res, accessToken, newRefreshToken);
    } catch (error) {
        return errorResponse(error, "refresh access token");
    }
}
