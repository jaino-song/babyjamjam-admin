import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { invalidJsonResponse, readJsonObjectBody } from "@/lib/api/route-utils";

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
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/persist`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
        });

        if (!backendResponse.ok) {
            const errorText = await backendResponse.text();
            return new Response(JSON.stringify({ error: errorText }), {
                status: backendResponse.status,
                headers: { "Content-Type": "application/json" },
            });
        }

        const responseBody = await backendResponse.text();
        return new Response(responseBody || "{}", {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
