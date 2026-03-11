import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Authentication required. Please log in.");
    }

    const body = await request.json();
    const response = await serverAPIClient.post("/message-deliveries/sms", body, {
      headers: getAuthHeaders(token),
    });

    if (response.status >= 400) {
      return NextResponse.json(response.data, { status: response.status });
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "send SMS delivery");
  }
}
