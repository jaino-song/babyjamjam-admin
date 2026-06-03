import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { getUpstreamErrorStatus, logUpstreamError, sanitizeUpstreamClientError } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/forgot-password", body);

        return NextResponse.json(data, { status });
    } catch (error) {
        logUpstreamError("Auth Forgot Password", error);

        if (error instanceof AxiosError) {
            const status = getUpstreamErrorStatus(error);
            const responseData = error.response?.data;

            return NextResponse.json(
                sanitizeUpstreamClientError(responseData, "Request failed"),
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
