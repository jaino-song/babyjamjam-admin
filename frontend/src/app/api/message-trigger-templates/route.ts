import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const searchParams = request.nextUrl.searchParams;
    const response = await serverAPIClient.get("/message-trigger-templates", {
      headers: getAuthHeaders(token),
      params: {
        provider: searchParams.get("provider"),
        eventType: searchParams.get("eventType"),
        recipientType: searchParams.get("recipientType"),
      },
    });
    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "fetch message trigger templates", "read");
  }
}
