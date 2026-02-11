import { NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL;

export async function POST() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
            { error: "Test endpoint disabled in production" },
            { status: 403 }
        );
    }

    if (!BACKEND_URL) {
        return NextResponse.json(
            { error: "Backend URL not configured" },
            { status: 500 }
        );
    }

    try {
        const response = await fetch(`${BACKEND_URL}/notifications/test-broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error("Test broadcast error:", error);
        return NextResponse.json(
            { error: "Failed to send test broadcast" },
            { status: 500 }
        );
    }
}
