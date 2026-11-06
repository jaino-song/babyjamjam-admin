import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const response = await serverAPIClient.get("/settings/message-automation-policies/config", {
      headers: getAuthHeaders(token), params,
    });
    if (response.status >= 400) return errorResponse({ response }, "message policy", "read");
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "message policy", "read");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const response = await serverAPIClient.put("/settings/message-automation-policies/config", await request.json(), {
      headers: getAuthHeaders(token), params,
    });
    if (response.status >= 400) return errorResponse({ response }, "message policy", "mutation");
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "message policy", "mutation");
  }
}
