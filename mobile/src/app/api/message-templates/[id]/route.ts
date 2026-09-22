import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
} from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

function isValidTemplateId(id: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

function invalidTemplateIdResponse() {
    return validationProblemResponse("Invalid message template id", [
        { pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
    ]);
}

// Mirrors backend UpdateMessageTemplateDto: every field is optional, so this is
// a passthrough object that only type-checks the known fields when present.
const updateMessageTemplateSchema = z
    .object({
        name: z.string().max(10_000).optional(),
        content: z.string().max(10_000).optional(),
        variables: z.array(z.unknown()).optional(),
    })
    .passthrough();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch message template");
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { id } = await params;
        if (!isValidTemplateId(id)) {
            return invalidTemplateIdResponse();
        }

        const { data, response: invalidBody } = await parseBody(
            updateMessageTemplateSchema,
            request,
        );
        if (invalidBody) {
            return invalidBody;
        }

        const response = await serverAPIClient.patch(`/message-templates/${id}`, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "update message template");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const { id } = await params;
        const response = await serverAPIClient.delete(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete message template");
    }
}
