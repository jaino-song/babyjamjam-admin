import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime, memberEmail } = body;

        const response = await serverAPIClient.post("/api/access-token", {
            executionTime,
            memberEmail,
        });

        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[Access Token API] Error:", error.message);
        return NextResponse.json(
            { error: error.message || "Failed to get access token" },
            { status: error.response?.status || 500 }
        );
    }
}
