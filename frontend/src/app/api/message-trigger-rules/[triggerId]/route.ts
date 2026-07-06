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
    const response = await serverAPIClient.get(`/message-trigger-rules/${triggerId}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching message trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to fetch message trigger rule" },
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
    const response = await serverAPIClient.patch(`/message-trigger-rules/${triggerId}`, body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error updating message trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to update message trigger rule" },
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
    await serverAPIClient.delete(`/message-trigger-rules/${triggerId}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting message trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to delete message trigger rule" },
      { status: 500 },
    );
  }
}
