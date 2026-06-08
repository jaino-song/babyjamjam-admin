import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAccessToken,
    getAuthHeaders,
    getAuthToken,
    getRefreshToken,
    parseBody,
    sanitizeUpstreamClientError,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend GenerateStaffDocumentRequestDto: documentId is
// @IsString() @IsNotEmpty() and required (replacing the manual !documentId
// check). accessToken/refreshToken/prefillEndDate are read from the body when
// present (falling back to cookies for the tokens), so they stay optional in
// this schema; passthrough preserves any forward-compatible fields.
const generateStaffDocumentSchema = z
    .object({
        documentId: z.string().min(1),
        accessToken: z.string().optional(),
        refreshToken: z.string().optional(),
        prefillEndDate: z.string().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const authToken = getAuthToken(request);
    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { data: body, response: invalid } = await parseBody(generateStaffDocumentSchema, request);
    if (invalid) {
        return invalid;
    }

    const accessToken =
        typeof body.accessToken === "string" && body.accessToken
            ? body.accessToken
            : getAccessToken(request);
    const refreshToken =
        typeof body.refreshToken === "string" && body.refreshToken
            ? body.refreshToken
            : getRefreshToken(request);

    if (!accessToken || !refreshToken) {
        return unauthorizedResponse("Authentication required. Please authenticate first.");
    }

    try {
        const response = await serverAPIClient.post("/api/generate-staff-document", {
            documentId: body.documentId,
            accessToken,
            refreshToken,
            prefillEndDate: body.prefillEndDate,
        }, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to generate staff document"),
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "generate staff document");
    }
}
