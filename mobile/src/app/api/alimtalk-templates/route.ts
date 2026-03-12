import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthToken, getAuthHeaders } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const response = await serverAPIClient.post("/alimtalk-templates", body, {
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error("[API] Error creating alimtalk template:", error);
    return NextResponse.json(
      { error: "Failed to create alimtalk template" },
      { status: 500 },
    );
  }
}
