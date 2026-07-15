import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();

        const response = await serverAPIClient.post("/eformsign-docs", body, {
            headers: { Authorization: `Bearer ${token}` },
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "create eformsign doc record");
    }
}
