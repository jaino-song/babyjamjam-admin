import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { getUpstreamErrorStatus, logUpstreamError, parseBody, sanitizeUpstreamClientError } from "@/lib/api/route-utils";

const resendVerificationSchema = z
    .object({
        email: z.string().email(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(resendVerificationSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/resend-verification", data);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        logUpstreamError("Auth Resend Verification", error);

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
