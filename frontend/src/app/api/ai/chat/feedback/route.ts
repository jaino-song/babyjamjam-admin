import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { authRequiredResponse, errorResponse, upstreamFetchErrorResponse } from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    if (!authToken) {
        return authRequiredResponse();
    }

    try {
        const body = await req.json();

        const response = await fetch(`${BACKEND_URL}/ai/chat/feedback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return upstreamFetchErrorResponse(response, "submit chat feedback", "mutation");
        }

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "submit chat feedback");
    }
}
