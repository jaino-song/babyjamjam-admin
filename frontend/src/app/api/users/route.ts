import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return authRequiredResponse();
  }

  try {
    const response = await serverAPIClient.get("/users", {
      headers: getAuthHeaders(authToken),
    });

    if (response.status >= 400) {
      return errorResponse({ response }, "fetch users", "read");
    }

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "fetch users", "read");
  }
}
