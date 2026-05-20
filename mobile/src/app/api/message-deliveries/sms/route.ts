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
    const response = await serverAPIClient.post("/message-deliveries/sms", body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    if (error && typeof error === "object" && "response" in error) {
      const axiosErr = error as { response?: { status?: number; data?: unknown } };
      if (axiosErr.response) {
        return NextResponse.json(axiosErr.response.data, { status: axiosErr.response.status ?? 500 });
      }
    }
    console.error("[API] Error sending SMS:", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 },
    );
  }
}
