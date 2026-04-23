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

    const limit = request.nextUrl.searchParams.get("limit") ?? "3";
    const response = await serverAPIClient.get("/clients/alerts", {
      params: { limit },
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error("[API] Error fetching client alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch client alerts" },
      { status: 500 },
    );
  }
}
