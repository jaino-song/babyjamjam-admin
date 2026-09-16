import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthToken, parseBody } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

const linkPasswordSchema = z
    .object({
        password: z.string().min(8),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
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
        return errorResponse(error, "link password");
    }
}
