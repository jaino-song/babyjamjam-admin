import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
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
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch message trigger templates");
  }
}
