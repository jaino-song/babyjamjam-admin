import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend GenerateSignatureRequestDto: executionTime is
// @IsNumber() @Min(0) and required. The route forwards only executionTime.
const generateSignatureSchema = z
    .object({
        executionTime: z.number().min(0),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const authToken = getAuthToken(request);
    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { data, response: invalid } = await parseBody(generateSignatureSchema, request);
    if (invalid) {
        return invalid;
    }

    const { executionTime } = data;

    try {
        const response = await serverAPIClient.post("/api/generate-signature", {
            executionTime,
        }, {
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "generate signature");
    }
}
