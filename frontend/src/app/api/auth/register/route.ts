import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
    hasKakaoAccount?: boolean;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/register", body);

        return NextResponse.json(data, { status });
    } catch (error) {
        console.error("[Auth Register] Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = axiosError.response?.status || 500;
            const responseData = axiosError.response?.data;

            // Pass through the error response from backend
            if (responseData) {
                return NextResponse.json(responseData, { status });
            }

            return NextResponse.json(
                { error: axiosError.message || "Registration failed" },
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
