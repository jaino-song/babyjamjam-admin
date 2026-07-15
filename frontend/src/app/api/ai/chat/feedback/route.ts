import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function POST(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const authToken = cookieStore.get("auth_token");
        if (!authToken) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();

        const response = await fetch(`${BACKEND_URL}/ai/chat/feedback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error("Feedback proxy error:", error);
        return NextResponse.json({ success: false, error: "Failed to submit feedback" }, { status: 500 });
    }
}
