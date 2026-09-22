import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
        return authRequiredResponse();
    }

    const { id } = await params;

    try {
        const response = await serverAPIClient.post(
            `/message-trigger-jobs/${encodeURIComponent(id)}/cancel`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
        );

        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        return errorResponse(error, "cancel message trigger job", "mutation");
    }
}
