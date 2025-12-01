import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const accessToken = searchParams.get("accessToken");

        if (!accessToken) {
            return NextResponse.json(
                { error: "Access token is required" },
                { status: 400 }
            );
        }

        const response = await serverAPIClient.get("/api/documents", {
            params: { accessToken },
        });

        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[Documents API] Error:", error.message);
        return NextResponse.json(
            { error: error.message || "Failed to fetch documents" },
            { status: error.response?.status || 500 }
        );
    }
}
