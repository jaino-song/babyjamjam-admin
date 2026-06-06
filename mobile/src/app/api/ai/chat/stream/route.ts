import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { invalidJsonResponse, readJsonObjectBody, upstreamSseErrorResponse } from "@/lib/api/route-utils";

const BACKEND_URL = BACKEND_BASE_URL;

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const body = await readJsonObjectBody(request);

        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
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
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return upstreamSseErrorResponse();
    }
}
