import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/verify-email", body);

        return NextResponse.json(data, { status });
    } catch (error) {
        return errorResponse(error, "verify email");
    }
}
