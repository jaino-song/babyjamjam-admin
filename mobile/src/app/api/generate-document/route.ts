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
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend GenerateDocumentRequestDto: contractData is a required
// nested object (@ValidateNested, no @IsOptional); clientId is required.
// accessToken/refreshToken come from cookies here, not the body, so they are
// not part of this schema. The route destructures contractData/clientId and
// forwards the cookie-derived tokens. Passthrough keeps contractData's nested
// fields for the backend's authoritative ValidationPipe.
const generateDocumentSchema = z
    .object({
        contractData: z.object({}).passthrough(),
        clientId: z.number().int().min(1),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const authToken = getAuthToken(request);
    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { data, response: invalid } = await parseBody(generateDocumentSchema, request);
    if (invalid) {
        return invalid;
    }

    const { contractData, clientId } = data;

    const accessToken = getAccessToken(request);
    const refreshToken = getRefreshToken(request);

    if (!accessToken || !refreshToken) {
        return unauthorizedResponse("Authentication required. Please authenticate first.");
    }

    try {
        const response = await serverAPIClient.post("/api/generate-document", {
            contractData,
            accessToken,
            refreshToken,
            clientId,
        }, {
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "generate document");
    }
}
