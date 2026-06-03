import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";

const BACKEND_URL = BACKEND_BASE_URL;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function jsonResponse(data: unknown, status: number): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function invalidSessionIdResponse(): Response {
    return jsonResponse({ error: "Invalid session id" }, 400);
}

function getSessionUrl(id: string): string | null {
    if (!SESSION_ID_PATTERN.test(id)) {
        return null;
    }

    return `${BACKEND_URL}/ai/chat/sessions/${encodeURIComponent(id)}`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    const { id } = await params;

    if (!authToken) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const sessionUrl = getSessionUrl(id);
    if (!sessionUrl) {
        return invalidSessionIdResponse();
    }

    const backendResponse = await fetch(sessionUrl, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${authToken.value}`,
        },
    });

    const data = await backendResponse.json();

    return jsonResponse(data, backendResponse.status);
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    const { id } = await params;

    if (!authToken) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const sessionUrl = getSessionUrl(id);
    if (!sessionUrl) {
        return invalidSessionIdResponse();
    }

    const backendResponse = await fetch(sessionUrl, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${authToken.value}`,
        },
    });

    if (backendResponse.status === 204) {
        return new Response(null, { status: 204 });
    }

    const data = await backendResponse.json();

    return jsonResponse(data, backendResponse.status);
}
