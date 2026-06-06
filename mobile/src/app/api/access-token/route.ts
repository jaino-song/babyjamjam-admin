import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    sanitizeUpstreamClientError,
    setAuthCookies,
} from "@/lib/api/route-utils";

// Mirrors backend AccessTokenRequestDto: executionTime is @IsNumber() @Min(0)
// required; memberEmail is @IsOptional() @IsString() @IsNotEmpty(). The route
// destructures and forwards exactly these two fields.
const accessTokenSchema = z
    .object({
        executionTime: z.number().min(0),
        memberEmail: z.string().min(1).optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const authToken = getAuthToken(request);
    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized - please log in first" }, { status: 401 });
    }

    const { data, response: invalid } = await parseBody(accessTokenSchema, request);
    if (invalid) {
        return invalid;
    }

    const { executionTime, memberEmail } = data;

    try {
        const response = await serverAPIClient.post("/api/access-token", {
            executionTime,
            memberEmail,
        }, {
            headers: getAuthHeaders(authToken),
        });

        // Check for error response (serverAPIClient doesn't throw on HTTP errors)
        if (response.status >= 400) {
            const safeError = sanitizeUpstreamClientError(response.data, "Failed to get access token");
            console.error("[access-token] Backend error:", {
                status: response.status,
                code: safeError.code,
            });
            return NextResponse.json(safeError, { status: response.status });
        }

        const { oauth_token } = response.data;

        // Validate response structure
        if (!oauth_token?.access_token || !oauth_token?.refresh_token) {
            console.error("[access-token] Invalid response structure:", {
                status: response.status,
                hasOauthToken: Boolean(response.data?.oauth_token),
            });
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
