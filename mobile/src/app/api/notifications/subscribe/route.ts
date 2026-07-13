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

// Mirrors backend SubscribePushDto: endpoint/p256dh/auth are @IsString()
// @IsNotEmpty() required; userAgent is optional. Passthrough preserves any
// forward-compatible fields.
const subscribePushSchema = z
    .object({
        endpoint: z.string().min(1),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        userAgent: z.string().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(subscribePushSchema, request);
        if (invalid) return invalid;

        const response = await serverAPIClient.post("/notifications/subscribe", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "subscribe to notifications");
    }
}
