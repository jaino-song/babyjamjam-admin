import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthToken, getUpstreamErrorStatus, logUpstreamError, sanitizeUpstreamClientError } from "@/lib/api/route-utils";
import { AxiosError } from "axios";

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/link-password", body, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        return NextResponse.json(data, { status });
    } catch (error) {
        logUpstreamError("Auth Link Password", error);

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
