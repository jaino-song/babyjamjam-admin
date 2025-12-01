import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime, refreshToken } = body;

        const response = await serverAPIClient.post("/api/refresh-token", {
            executionTime,
            refreshToken,
        });

        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[Refresh Access Token API] Error:", error.message);
        return NextResponse.json(
            { error: error.message || "Failed to refresh access token" },
            { status: error.response?.status || 500 }
        );
    }
}
