import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { authRequiredResponse, errorResponse, upstreamFetchErrorResponse } from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return authRequiredResponse();
    }

    const { searchParams } = new URL(request.url);
    const offset = searchParams.get("offset") ?? "0";
    const limit = searchParams.get("limit") ?? "20";

    try {
        const backendResponse = await fetch(
            `${BACKEND_URL}/ai/chat/history?offset=${offset}&limit=${limit}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${authToken.value}`,
                },
            }
        );

        if (!backendResponse.ok) {
            return upstreamFetchErrorResponse(backendResponse, "fetch chat history", "read");
        }

        const data = await backendResponse.json();
        return NextResponse.json(data);
    } catch (error) {
        return errorResponse(error, "fetch chat history", "read");
    }
}
