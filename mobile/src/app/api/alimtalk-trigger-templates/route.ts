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
    const response = await serverAPIClient.get("/alimtalk-trigger-templates", {
      headers: getAuthHeaders(token),
      params: {
        provider: searchParams.get("provider"),
        eventType: searchParams.get("eventType"),
        recipientType: searchParams.get("recipientType"),
      },
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching alimtalk trigger templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch alimtalk trigger templates" },
      { status: 500 },
    );
  }
}
