import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const limit = request.nextUrl.searchParams.get("limit") ?? "3";
    const response = await serverAPIClient.get("/clients/alerts", {
      params: { limit },
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "fetch client alerts", "read");
  }
}
