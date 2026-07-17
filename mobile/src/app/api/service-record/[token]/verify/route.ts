import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { setServiceRecordAccessCookie } from "@/lib/api/service-record-auth";

function getAccessToken(data: unknown): string | null {
    if (!data || typeof data !== "object" || !("ok" in data) || !("accessToken" in data)) return null;
    if (data.ok !== true || typeof data.accessToken !== "string") return null;
    return data.accessToken;
}

// Public: phone challenge. The [token] path segment IS the link token.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post("/service-record/verify", {
            linkToken: token,
            phone: body?.phone ?? "",
        });
        const accessToken = getAccessToken(response.data);
        if (accessToken) {
            const verifiedResponse = withNoStore(NextResponse.json({ ok: true }, { status: response.status }));
            setServiceRecordAccessCookie(verifiedResponse, token, accessToken);
            return verifiedResponse;
        }
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "verify service record phone");
    }
}
