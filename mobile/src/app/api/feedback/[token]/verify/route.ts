import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

// Public: DOB challenge. The [token] path segment IS the link token.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post("/service-feedback/verify", {
            linkToken: token,
            dob: body?.dob ?? "",
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "verify feedback dob");
    }
}
