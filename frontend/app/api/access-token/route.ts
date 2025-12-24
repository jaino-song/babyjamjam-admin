import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { setAuthCookies, errorResponse } from "@/app/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime, memberEmail } = body;

        const response = await serverAPIClient.post("/api/access-token", {
            executionTime,
            memberEmail,
        });

        const { oauth_token } = response.data;

        // Create response and set tokens in httpOnly cookies
        const res = NextResponse.json({ success: true });
        return setAuthCookies(res, oauth_token.access_token, oauth_token.refresh_token);
    } catch (error) {
        return errorResponse(error, "get access token");
    }
}
