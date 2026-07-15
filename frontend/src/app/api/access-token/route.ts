import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { setAuthCookies, errorResponse, getAuthToken, getAuthHeaders } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return NextResponse.json({ error: "Unauthorized - please log in first" }, { status: 401 });
        }

        const body = await request.json();
        const { executionTime, memberEmail } = body;

        const response = await serverAPIClient.post("/api/access-token", {
            executionTime,
            memberEmail,
        }, {
            headers: getAuthHeaders(authToken),
        });

        // Check for error response (serverAPIClient doesn't throw on HTTP errors)
        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            console.error("[access-token] Backend error:", errorMessage);
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        const { oauth_token } = response.data;

        // Validate response structure
        if (!oauth_token?.access_token || !oauth_token?.refresh_token) {
            console.error("[access-token] Invalid response structure:", response.data);
            return NextResponse.json(
                { error: "Invalid response from authentication service" },
                { status: 500 }
            );
        }

        // Create response and set tokens in httpOnly cookies
        const res = NextResponse.json({ success: true });
        return setAuthCookies(res, oauth_token.access_token, oauth_token.refresh_token);
    } catch (error) {
        return errorResponse(error, "get access token");
    }
}
