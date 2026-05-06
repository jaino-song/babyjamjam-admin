import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/eformsign-docs/approve", body, {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "approve document");
    }
}
