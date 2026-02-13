import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/message-templates", { 
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error("[API] Error fetching message templates:", error);
        return NextResponse.json(
            { error: "Failed to fetch message templates" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/message-templates", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[API] Error creating message template:", error);
        return NextResponse.json(
            { error: "Failed to create message template" },
            { status: 500 }
        );
    }
}
