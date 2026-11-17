import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  withNoStore,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return unauthorizedProblemResponse();

    const response = await serverAPIClient.get("/clients/service-record-missing", {
      headers: getAuthHeaders(token),
    });
    return withNoStore(backendJsonResponse(response));
  } catch (error) {
    return errorResponse(error, "fetch service record missing clients", "read");
  }
}
