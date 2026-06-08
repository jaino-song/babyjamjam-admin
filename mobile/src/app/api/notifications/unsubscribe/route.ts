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

// Mirrors backend UnsubscribePushDto: endpoint is the only field, @IsString()
// @IsNotEmpty() required. Passthrough preserves any forward-compatible fields.
const unsubscribePushSchema = z
    .object({
        endpoint: z.string().min(1),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(unsubscribePushSchema, request);
        if (invalid) return invalid;

        const response = await serverAPIClient.post("/notifications/unsubscribe", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "unsubscribe from notifications");
    }
}
