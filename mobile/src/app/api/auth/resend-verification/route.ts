import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

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
        return errorResponse(error, "resend verification email");
    }
}
