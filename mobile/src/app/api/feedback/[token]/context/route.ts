import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

// Guarded by the minted access token (forwarded from the page's Authorization header).
export async function GET(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    try {
        const response = await serverAPIClient.get("/service-feedback/context", {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "feedback context");
    }
}
