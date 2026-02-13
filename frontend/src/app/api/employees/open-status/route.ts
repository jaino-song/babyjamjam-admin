import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function PATCH(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
        }

        const body = await request.json();
        const response = await serverAPIClient.patch("/employees/open-status", body, {
            params: { id },
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("[API] Error updating employee open status:", error.message);
        return NextResponse.json(
            { error: "Failed to update employee open status" },
            { status: error.response?.status || 500 }
        );
    }
}
