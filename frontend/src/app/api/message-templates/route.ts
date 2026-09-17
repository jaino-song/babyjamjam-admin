import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const response = await serverAPIClient.get("/message-templates", {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch message templates", "read");
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/message-templates", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        return errorResponse(error, "create message template", "mutation");
    }
}
