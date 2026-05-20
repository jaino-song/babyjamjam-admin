import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthToken, getAuthHeaders } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const response = await serverAPIClient.get("/alimtalk-trigger-jobs/upcoming", {
      headers: getAuthHeaders(token),
      params: {
        limit: searchParams.get("limit") ?? undefined,
      },
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching upcoming alimtalk trigger jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch upcoming alimtalk trigger jobs" },
      { status: 500 },
    );
  }
}
