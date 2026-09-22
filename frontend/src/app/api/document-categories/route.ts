import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

function requireAuth(request: NextRequest) {
    const token = getAuthToken(request);
    return token ? { token } : null;
}

export async function GET(request: NextRequest) {
    const auth = requireAuth(request);
    if (!auth) {
        return authRequiredResponse();
    }

    try {
        const response = await serverAPIClient.get("/document-categories", {
            headers: getAuthHeaders(auth.token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch document categories", "read");
    }
}

export async function POST(request: NextRequest) {
    const auth = requireAuth(request);
    if (!auth) {
        return authRequiredResponse();
    }

    try {
        const body = await request.json();
        const response = await serverAPIClient.post("/document-categories", body, {
            headers: getAuthHeaders(auth.token),
        });
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        return errorResponse(error, "create document category");
    }
}
