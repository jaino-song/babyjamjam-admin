import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import {
    authRequiredResponse,
    errorResponse,
    upstreamFetchErrorResponse,
} from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    const { id } = await params;

    if (!authToken) {
        return authRequiredResponse();
    }

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/sessions/${id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${authToken.value}`,
            },
        });

        if (!backendResponse.ok) {
            return upstreamFetchErrorResponse(backendResponse, "fetch chat session", "read");
        }

        const data = await backendResponse.json();

        return new Response(JSON.stringify(data), {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return errorResponse(error, "fetch chat session", "read");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    const { id } = await params;

    if (!authToken) {
        return authRequiredResponse();
    }

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/sessions/${id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${authToken.value}`,
            },
        });

        if (backendResponse.status === 204) {
            return new Response(null, { status: 204 });
        }

        if (!backendResponse.ok) {
            return upstreamFetchErrorResponse(backendResponse, "delete chat session", "mutation");
        }

        const data = await backendResponse.json();

        return new Response(JSON.stringify(data), {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return errorResponse(error, "delete chat session", "mutation");
    }
}
