import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const body = await request.json();
    const expectedBranchId = request.nextUrl.searchParams.get("expectedBranchId");
    const response = await serverAPIClient.post("/message-deliveries/sms", body, {
      headers: { ...getAuthHeaders(token), ...(request.headers.has("Idempotency-Key") ? { "Idempotency-Key": request.headers.get("Idempotency-Key")! } : {}) },
      ...(expectedBranchId !== null ? { params: { expectedBranchId } } : {}),
    });

    if (response.status >= 400) {
      return errorResponse({ response }, "send SMS delivery", "mutation");
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "send SMS delivery", "mutation");
  }
}
