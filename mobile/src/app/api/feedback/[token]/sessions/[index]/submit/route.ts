import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; index: string }> }) {
    const { index } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post(
            `/service-feedback/sessions/${encodeURIComponent(index)}/submit`,
            body,
            { headers: { Authorization: authorization } },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "submit feedback session");
    }
}
