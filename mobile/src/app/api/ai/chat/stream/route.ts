import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody, upstreamSseErrorResponse } from "@/lib/api/route-utils";

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
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
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
            await backendResponse.text().catch(() => "");
            return upstreamSseErrorResponse(backendResponse.status);
        }

        return new Response(backendResponse.body, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch {
        return upstreamSseErrorResponse();
    }
}
