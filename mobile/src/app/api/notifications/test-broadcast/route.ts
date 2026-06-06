import { NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import type { NextRequest } from "next/server";

const BACKEND_URL = BACKEND_BASE_URL;

export async function POST(request: NextRequest) {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
            { error: "Test endpoint disabled in production" },
            { status: 403 }
        );
    }

    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
            headers: { "Content-Type": "application/json", ...getAuthHeaders(token) },
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
