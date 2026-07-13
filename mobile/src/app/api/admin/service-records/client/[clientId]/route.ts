import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ clientId: string }> };

function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

function invalidClientIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { clientId } = await params;
        if (!isPositiveIntegerString(clientId)) {
            return invalidClientIdResponse();
        }

        const response = await serverAPIClient.get(`/admin/service-records/client/${clientId}`, {
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch client service records");
    }
}
