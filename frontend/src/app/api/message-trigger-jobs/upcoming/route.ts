import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const limit = request.nextUrl.searchParams.get("limit");
    const response = await serverAPIClient.get("/message-trigger-jobs/upcoming", {
      headers: getAuthHeaders(token),
      params: limit ? { limit } : undefined,
    });

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "fetch upcoming message trigger jobs", "read");
  }
}
