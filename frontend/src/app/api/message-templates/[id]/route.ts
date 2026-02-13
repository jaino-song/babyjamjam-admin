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
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[API] Error fetching message template ${request.url}:`, error);
        return NextResponse.json(
            { error: "Failed to fetch message template" },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const response = await serverAPIClient.patch(`/message-templates/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[API] Error updating message template ${request.url}:`, error);
        return NextResponse.json(
            { error: "Failed to update message template" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        await serverAPIClient.delete(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error(`[API] Error deleting message template ${request.url}:`, error);
        return NextResponse.json(
            { error: "Failed to delete message template" },
            { status: 500 }
        );
    }
}
