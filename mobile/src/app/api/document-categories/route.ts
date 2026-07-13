import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend CreateDocumentCategoryDto: `value`, `label`, `color` are all
// required strings (@IsString, no @IsOptional). Other fields pass through to the
// backend's authoritative ValidationPipe.
const createDocumentCategorySchema = z
    .object({
        value: z.string().max(10_000),
        label: z.string().max(10_000),
        color: z.string().max(10_000),
    })
    .passthrough();

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.get("/document-categories", {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch document categories");
    }
}

export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { data, response } = await parseBody(createDocumentCategorySchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.post("/document-categories", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "create document category");
    }
}
