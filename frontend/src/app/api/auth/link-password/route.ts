import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthToken } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/link-password", body, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        return NextResponse.json(data, { status });
    } catch (error) {
        return errorResponse(error, "set link password");
    }
}
