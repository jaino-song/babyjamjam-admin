import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    backendJsonResponse,
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

    const limit = request.nextUrl.searchParams.get("limit") ?? "50";
    const response = await serverAPIClient.get("/clients/dashboard-overview", {
      params: { limit },
      headers: getAuthHeaders(token),
    });

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch dashboard overview", "read");
  }
}
