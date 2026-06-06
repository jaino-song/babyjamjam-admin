import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody, upstreamSseErrorResponse } from "@/lib/api/route-utils";

const BACKEND_URL = BACKEND_BASE_URL;

// Mirrors backend ChatStreamDto: `message` is required (@IsNotEmpty @IsString),
// `sessionId` optional string. Other fields pass through to the backend pipe.
const chatStreamSchema = z
    .object({
        message: z.string().min(1).max(10_000),
        sessionId: z.string().optional(),
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
