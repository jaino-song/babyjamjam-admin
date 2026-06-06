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

// Mirrors backend CreateMessageTemplateDto: name, content and variables (array)
// are all required; optional/forward-compatible fields flow through passthrough.
const createMessageTemplateSchema = z
    .object({
        name: z.string().max(10_000),
        content: z.string().max(10_000),
        variables: z.array(z.unknown()),
    })
    .passthrough();

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.get("/message-templates", { 
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch message templates");
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalidBody } = await parseBody(
            createMessageTemplateSchema,
            request,
        );
        if (invalidBody) {
            return invalidBody;
        }

        const response = await serverAPIClient.post("/message-templates", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "create message template");
    }
}
