import { NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, logUpstreamError, upstreamStatusProblemResponse } from "@/lib/api/route-utils";

/**
 * GET /api/notifications/vapid-key
 * Public endpoint - no auth required
 * Returns the VAPID public key needed for push notification subscription
 */
export async function GET() {
    try {
        const response = await serverAPIClient.get("/notifications/vapid-key");
        return NextResponse.json(response.data);
    } catch (error: unknown) {
        const status = (error as { response?: { status?: number } }).response?.status;
        // A transport failure has no upstream status: answer with the
        // registered 500 problem instead of a raw English body.
        if (!status) {
            logUpstreamError("fetch vapid key", error);
            return upstreamStatusProblemResponse(500, "fetch vapid key", "UNKNOWN");
        }
        // An upstream failure keeps its status; a problem+json body is
        // propagated faithfully, anything else is sanitized to the Korean
        // catalog copy.
        return errorResponse(error, "fetch vapid key", "read");
    }
}
