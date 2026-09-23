import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

type RouteParams = { params: Promise<{ id: string }> };

function isValidInquiryId(id: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

function invalidInquiryIdResponse() {
    return validationProblemResponse("Invalid inquiry id", [
        { pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
    ]);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
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
