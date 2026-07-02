import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

// Public: is the SMS link still usable? (no PII before the phone challenge)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const response = await serverAPIClient.get(`/service-feedback/link/${encodeURIComponent(token)}`);
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "feedback link status");
    }
}
