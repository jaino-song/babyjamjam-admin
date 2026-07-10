import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const clientId = request.nextUrl.searchParams.get("clientId");
        if (!clientId) {
            return NextResponse.json({ error: "clientId is required" }, { status: 400 });
        }

        const response = await serverAPIClient.get("/eformsign-docs/client", {
            params: { clientId },
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "list eformsign docs by client");
    }
}
