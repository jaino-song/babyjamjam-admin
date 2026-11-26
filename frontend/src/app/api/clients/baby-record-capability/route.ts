import { NextRequest, NextResponse } from "next/server";

import { parseBabyRecordCapability } from "@/features/clients/api/baby-record-capability";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken, localProblemResponse } from "@/lib/api/route-utils";

async function readCapability(request: NextRequest): Promise<NextResponse> {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();

    try {
        const { data, status } = await serverAPIClient.get<unknown>("/clients/baby-record-capability", {
            headers: getAuthHeaders(token),
        });
        const capability = parseBabyRecordCapability(data);
        return capability ? NextResponse.json(capability, { status }) : localProblemResponse("UPSTREAM_INVALID_RESPONSE");
    } catch (error) {
        return errorResponse(error, "read client baby-record capability", "read");
    }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const response = await readCapability(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
}
