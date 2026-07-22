import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/out-of-pocket-price-infos", {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "fetch out-of-pocket price infos");
    }
}
