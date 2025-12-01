import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { executionTime } = body;

        const response = await serverAPIClient.post("/api/generate-signature", {
            executionTime,
        });

        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[Generate Signature API] Error:", error.message);
        return NextResponse.json(
            { error: error.message || "Failed to generate signature" },
            { status: error.response?.status || 500 }
        );
    }
}
