import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

        const response = await fetch(`${backendUrl}/ai/chat/feedback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: req.headers.get("Authorization") || "",
                Cookie: req.headers.get("Cookie") || "",
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
