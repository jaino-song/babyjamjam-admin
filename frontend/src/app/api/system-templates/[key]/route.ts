import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { key } = await params;
        const response = await serverAPIClient.get(`/system-templates/${key}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[API] Error fetching system template ${request.url}:`, error);
        return NextResponse.json(
            { error: "Failed to fetch system template" },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { key } = await params;
        const body = await request.json();
        const response = await serverAPIClient.put(`/system-templates/${key}`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[API] Error updating system template ${request.url}:`, error);
        return NextResponse.json(
            { error: "Failed to update system template" },
            { status: 500 }
        );
    }
}
