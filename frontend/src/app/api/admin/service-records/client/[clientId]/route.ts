import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ clientId: string }> };

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { clientId } = await params;

    try {
        const response = await serverAPIClient.get(
            `/admin/service-records/client/${encodeURIComponent(clientId)}`,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("[API] Error fetching service records:", error);
        return NextResponse.json({ error: "Failed to fetch service records" }, { status: 500 });
    }
}
