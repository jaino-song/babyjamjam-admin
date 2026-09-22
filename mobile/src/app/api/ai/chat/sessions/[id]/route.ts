import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import {
    unauthorizedProblemResponse,
    upstreamBodyErrorResponse,
    upstreamUnavailableProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

const BACKEND_URL = BACKEND_BASE_URL;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function jsonResponse(data: unknown, status: number): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function invalidSessionIdResponse(): Response {
    return validationProblemResponse("Invalid session id", [
        { pointer: "/id", code: "INVALID_FORMAT", detail: "세션 ID 형식이 올바르지 않아요.", location: "path" },
    ]);
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
        return unauthorizedProblemResponse();
    }

    const sessionUrl = getSessionUrl(id);
    if (!sessionUrl) {
        return invalidSessionIdResponse();
    }

    let backendResponse: Response;
    try {
        backendResponse = await fetch(sessionUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${authToken.value}`,
            },
        });
    } catch {
        return upstreamUnavailableProblemResponse("read");
    }

    if (!backendResponse.ok) {
        const upstreamText = await backendResponse.text().catch(() => "");
        return upstreamBodyErrorResponse(backendResponse.status, upstreamText, "fetch chat session", "read");
    }

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
        return unauthorizedProblemResponse();
    }

    const sessionUrl = getSessionUrl(id);
    if (!sessionUrl) {
        return invalidSessionIdResponse();
    }

    let backendResponse: Response;
    try {
        backendResponse = await fetch(sessionUrl, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${authToken.value}`,
            },
        });
    } catch {
        return upstreamUnavailableProblemResponse("mutation");
    }

    if (backendResponse.status === 204) {
        return new Response(null, { status: 204 });
    }

    if (!backendResponse.ok) {
        const upstreamText = await backendResponse.text().catch(() => "");
        return upstreamBodyErrorResponse(backendResponse.status, upstreamText, "delete chat session");
    }

    const data = await backendResponse.json();

    return jsonResponse(data, backendResponse.status);
}
