import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthToken, getUpstreamErrorStatus, logUpstreamError, parseBody, sanitizeUpstreamClientError } from "@/lib/api/route-utils";
import { AxiosError } from "axios";

const linkPasswordSchema = z
    .object({
        password: z.string().min(8),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    const { data, response } = await parseBody(linkPasswordSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/link-password", data, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        return NextResponse.json(responseData, { status });
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
