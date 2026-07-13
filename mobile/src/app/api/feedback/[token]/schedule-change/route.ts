import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

// Guarded by the minted access token (forwarded from the page's Authorization header).
export async function POST(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    try {
        const response = await serverAPIClient.post("/service-feedback/schedule-change", {}, {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "schedule-change request");
    }
}
