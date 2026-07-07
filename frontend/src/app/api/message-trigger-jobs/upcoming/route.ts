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

    const limit = request.nextUrl.searchParams.get("limit");
    const response = await serverAPIClient.get("/message-trigger-jobs/upcoming", {
      headers: getAuthHeaders(token),
      params: limit ? { limit } : undefined,
    });

    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching upcoming message trigger jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch upcoming message trigger jobs" },
      { status: 500 },
    );
  }
}
