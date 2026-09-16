import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";

import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody } from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    upstreamBodyErrorResponse,
    upstreamUnavailableProblemResponse,
} from "@/lib/api/problem-responses";

const BACKEND_URL = BACKEND_BASE_URL;

const chatConfirmSchema = z
    .object({
        intentId: z.string().min(1),
        nonce: z.string().min(1),
        sessionId: z.string().min(1).nullable().optional(),
    })
    .strict();

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return unauthorizedProblemResponse();
    }

    const { data, response } = await parseBody(chatConfirmSchema, request);
    if (response) return response;

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/confirm`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        if (!backendResponse.ok) {
            const upstreamText = await backendResponse.text().catch(() => "");
            return upstreamBodyErrorResponse(backendResponse.status, upstreamText, "confirm chat");
        }

        const responseBody = await backendResponse.text();
        return new Response(responseBody || "{}", {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        return upstreamUnavailableProblemResponse("mutation");
    }
}
