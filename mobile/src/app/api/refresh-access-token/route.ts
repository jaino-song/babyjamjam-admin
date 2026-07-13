import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    getRefreshToken,
    parseBody,
    sanitizeUpstreamClientError,
    setAuthCookies,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Backend RefreshTokenRequestDto requires executionTime (@IsNumber() @Min(0))
// and refreshToken (@IsString() @IsNotEmpty()). This route supplies
// refreshToken from the httpOnly cookie, not the body, so the body schema
// requires only executionTime — the field the route reads from the body.
const refreshAccessTokenSchema = z
    .object({
        executionTime: z.number().min(0),
    })
    .passthrough();

type RefreshTokenResponse = {
    accessToken?: string;
    refreshToken?: string;
    oauth_token?: {
        access_token?: string;
        refresh_token?: string;
    };
};

function extractTokenPair(data: RefreshTokenResponse) {
    return {
        accessToken: data.oauth_token?.access_token ?? data.accessToken,
        refreshToken: data.oauth_token?.refresh_token ?? data.refreshToken,
    };
}

export async function POST(request: NextRequest) {
    const authToken = getAuthToken(request);
    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { data, response: invalid } = await parseBody(refreshAccessTokenSchema, request);
    if (invalid) {
        return invalid;
    }

    const { executionTime } = data;

    const refreshToken = getRefreshToken(request);
    if (!refreshToken) {
        return unauthorizedResponse("Refresh token not found. Please authenticate again.");
    }

    try {
        const response = await serverAPIClient.post("/api/refresh-token", {
            executionTime,
            refreshToken,
        }, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to refresh access token"),
                { status: response.status }
            );
        }

        const { accessToken, refreshToken: newRefreshToken } = extractTokenPair(response.data);
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
