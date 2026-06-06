import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody, upstreamJsonErrorResponse } from "@/lib/api/route-utils";

const BACKEND_URL = BACKEND_BASE_URL;

// Mirrors backend ChatPersistDto: `userMessage` and `assistantContent` are
// required (@IsNotEmpty @IsString); `sessionId` is optional. Other fields pass
// through to the backend pipe.
const chatPersistSchema = z
    .object({
        userMessage: z.string().min(1).max(10_000),
        assistantContent: z.string().min(1).max(10_000),
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

    const { data, response } = await parseBody(chatPersistSchema, request);
    if (response) return response;

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/persist`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        if (!backendResponse.ok) {
            await backendResponse.text().catch(() => "");
            return upstreamJsonErrorResponse(backendResponse.status);
        }

        const responseBody = await backendResponse.text();
        return new Response(responseBody || "{}", {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        return upstreamJsonErrorResponse(502);
    }
}
