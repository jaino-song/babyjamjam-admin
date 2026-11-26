import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken, withNoStore } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();

    const response = await serverAPIClient.get("/settings/message-automation-policies/canceled-retry", {
      headers: getAuthHeaders(token),
      params: { expectedBranchId: request.nextUrl.searchParams.get("expectedBranchId") },
    });
    return withNoStore(backendJsonResponse(response));
  } catch (error) {
    return errorResponse(error, "read canceled automation retry settings", "read");
  }
}
