import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

const forgotPasswordSchema = z
    .object({
        email: z.string().email(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(forgotPasswordSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/forgot-password", data);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        return errorResponse(error, "request password reset");
    }
}
