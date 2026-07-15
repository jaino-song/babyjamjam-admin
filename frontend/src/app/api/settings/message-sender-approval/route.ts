import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);

  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const response = await serverAPIClient.get("/settings/message-sender-approval", {
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "fetch message sender approval");
  }
}
