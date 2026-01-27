import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const offset = searchParams.get("offset") ?? "0";
    const limit = searchParams.get("limit") ?? "20";

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
        const errorText = await backendResponse.text();
        return NextResponse.json(
            { error: errorText },
            { status: backendResponse.status }
        );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
}
