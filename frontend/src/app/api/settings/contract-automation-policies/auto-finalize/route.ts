import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const ENDPOINT = "/settings/contract-automation-policies/auto-finalize";

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);

  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const body = await request.json();
    const response = await serverAPIClient.put(ENDPOINT, body, {
      headers: getAuthHeaders(token),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "update contract auto-finalize config", "mutation");
  }
}
