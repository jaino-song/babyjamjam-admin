import { NextResponse, NextRequest } from "next/server";
import { registerRequestSchema } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(registerRequestSchema, request);
    if (response) return response;

    try {
        const { data: responseData, status } = await serverAPIClient.post("/auth/register", data);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        return errorResponse(error, "register account");
    }
}
