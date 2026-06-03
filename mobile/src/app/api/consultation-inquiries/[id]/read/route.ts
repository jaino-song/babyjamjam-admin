import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

function isValidInquiryId(id: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

function invalidInquiryIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid inquiry id" }, { status: 400 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { id } = await params;
        if (!isValidInquiryId(id)) {
            return invalidInquiryIdResponse();
        }

        const response = await serverAPIClient.patch(
            `/consultation-inquiries/${encodeURIComponent(id)}/read`,
            undefined,
            { headers: getAuthHeaders(token) }
        );
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "mark consultation inquiry as read");
    }
}
