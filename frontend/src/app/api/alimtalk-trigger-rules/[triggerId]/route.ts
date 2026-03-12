import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { triggerId } = await context.params;
    const response = await serverAPIClient.get(`/alimtalk-trigger-rules/${triggerId}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching alimtalk trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to fetch alimtalk trigger rule" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { triggerId } = await context.params;
    const response = await serverAPIClient.patch(`/alimtalk-trigger-rules/${triggerId}`, body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error updating alimtalk trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to update alimtalk trigger rule" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { triggerId } = await context.params;
    await serverAPIClient.delete(`/alimtalk-trigger-rules/${triggerId}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting alimtalk trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to delete alimtalk trigger rule" },
      { status: 500 },
    );
  }
}
