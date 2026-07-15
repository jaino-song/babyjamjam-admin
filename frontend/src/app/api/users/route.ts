import { NextRequest, NextResponse } from "next/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const response = await serverAPIClient.get("/users", {
      headers: getAuthHeaders(authToken),
    });

    if (response.status >= 400) {
      const message = response.data?.error || response.data?.message || "Failed to fetch users";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "fetch users");
  }
}
