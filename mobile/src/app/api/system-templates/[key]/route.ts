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

// Mirrors backend UpdateSystemTemplateDto: content (@IsString @IsNotEmpty) is
// required; customVariables is @IsOptional. Passthrough lets the backend's
// authoritative ValidationPipe own the nested customVariables shape.
const updateSystemTemplateSchema = z
    .object({
        content: z.string().min(1),
    })
    .passthrough();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { key } = await params;
        const response = await serverAPIClient.get(`/system-templates/${key}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch system template");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { data, response: invalid } = await parseBody(updateSystemTemplateSchema, request);
    if (invalid) {
        return invalid;
    }

    try {
        const { key } = await params;
        const response = await serverAPIClient.put(`/system-templates/${key}`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "update system template");
    }
}
