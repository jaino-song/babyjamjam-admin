import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

interface RouteContext {
  params: Promise<{ branchId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);

  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  const { branchId } = await context.params;

  try {
    const response = await serverAPIClient.post(
      `/settings/message-sender-approval/${branchId}/approve`,
      {},
      { headers: getAuthHeaders(token) },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "approve message sender request");
  }
}
