import { NextResponse, NextRequest } from "next/server";
import { registerRequestSchema } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { getUpstreamErrorStatus, logUpstreamError, parseBody, sanitizeUpstreamClientError } from "@/lib/api/route-utils";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
    hasKakaoAccount?: boolean;
}

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(registerRequestSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/register", data);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        logUpstreamError("Auth Register", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = getUpstreamErrorStatus(error);
            const responseData = axiosError.response?.data;

            return NextResponse.json(
                sanitizeUpstreamClientError(responseData, "Registration failed"),
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
