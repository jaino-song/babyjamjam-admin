import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { AxiosError } from "axios";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/verify-email", body);

        return NextResponse.json(data, { status });
    } catch (error) {
        console.error("[Auth Verify Email] Error:", error);

        if (error instanceof AxiosError) {
            const status = error.response?.status || 500;
            const responseData = error.response?.data;

            if (responseData) {
                return NextResponse.json(responseData, { status });
            }

            return NextResponse.json(
                { error: error.message || "Verification failed" },
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
