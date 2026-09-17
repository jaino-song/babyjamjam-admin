import { NextRequest } from "next/server";

import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  try {
    return backendJsonResponse(
      await serverAPIClient.get("/system-admin/branch-requests", {
        headers: getAuthHeaders(token),
      }),
    );
  } catch (error) {
    return errorResponse(error, "fetch system admin branch requests");
  }
}
