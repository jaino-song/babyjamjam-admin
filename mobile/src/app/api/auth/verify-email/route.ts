import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

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
        return errorResponse(error, "verify email");
    }
}
