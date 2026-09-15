import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const ENDPOINT = "/settings/contract-automation-policies";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);

  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const response = await serverAPIClient.get(ENDPOINT, {
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "fetch contract automation policies", "read");
  }
}
