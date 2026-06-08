import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { getUpstreamErrorStatus, logUpstreamError, parseBody, sanitizeUpstreamClientError } from "@/lib/api/route-utils";

const verifyEmailSchema = z
    .object({
        token: z.string().min(1).max(10_000),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(verifyEmailSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/verify-email", data);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        logUpstreamError("Auth Verify Email", error);

        if (error instanceof AxiosError) {
            const status = getUpstreamErrorStatus(error);
            const responseData = error.response?.data;

            return NextResponse.json(
                sanitizeUpstreamClientError(responseData, "Verification failed"),
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
