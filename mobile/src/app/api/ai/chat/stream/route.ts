import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody } from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    upstreamSseTransportErrorResponse,
    upstreamSseUpstreamErrorResponse,
} from "@/lib/api/problem-responses";

const BACKEND_URL = BACKEND_BASE_URL;

// Mirrors backend ChatStreamDto: `message` is required (@IsNotEmpty @IsString),
// `sessionId` optional. useChatStream sends sessionId: null for NEW sessions
// and class-validator's @IsOptional treats null as absent, so the proxy must
// accept null too. No message cap: the backend DTO has none.
const chatStreamSchema = z
    .object({
        message: z.string().min(1),
        sessionId: z.string().nullable().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return unauthorizedProblemResponse();
    }

    const { data, response } = await parseBody(chatStreamSchema, request);
    if (response) return response;

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        if (!backendResponse.ok) {
            const upstreamText = await backendResponse.text().catch(() => "");
            return upstreamSseUpstreamErrorResponse(backendResponse.status, upstreamText || undefined, "mutation");
        }

        return new Response(backendResponse.body, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch {
        return upstreamSseTransportErrorResponse("mutation");
    }
}
