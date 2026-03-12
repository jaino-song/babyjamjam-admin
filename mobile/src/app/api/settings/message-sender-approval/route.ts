import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await serverAPIClient.get("/settings/message-sender-approval", {
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "message sender approval fetch");
  }
}

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await serverAPIClient.post(
      "/settings/message-sender-approval/request",
      body,
      {
        headers: getAuthHeaders(token),
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "message sender approval request");
  }
}
