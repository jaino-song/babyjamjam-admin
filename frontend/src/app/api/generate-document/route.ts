import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { getAccessToken, getRefreshToken, unauthorizedResponse, errorResponse } from "@/app/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contractData } = body;

        const accessToken = getAccessToken(request);
        const refreshToken = getRefreshToken(request);

        if (!accessToken || !refreshToken) {
            return unauthorizedResponse("Authentication required. Please authenticate first.");
        }

        const response = await serverAPIClient.post("/api/generate-document", {
            contractData,
            accessToken,
            refreshToken,
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "generate document");
    }
}
