import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contractData, accessToken, refreshToken } = body;

        const response = await serverAPIClient.post("/api/generate-document", {
            contractData,
            accessToken,
            refreshToken,
        });

        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[Generate Document API] Error:", error.message);
        return NextResponse.json(
            { error: error.message || "Failed to generate document" },
            { status: error.response?.status || 500 }
        );
    }
}
