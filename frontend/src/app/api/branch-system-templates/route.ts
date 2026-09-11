import { NextRequest, NextResponse } from "next/server";

import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

function getExpectedBranchId(request: NextRequest): string | undefined {
  const value = request.nextUrl.searchParams.get("expectedBranchId")?.trim();
  return value || undefined;
}

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const expectedBranchId = getExpectedBranchId(request);
    const response = await serverAPIClient.get("/branch-system-templates", {
      headers: getAuthHeaders(token),
      ...(expectedBranchId ? { params: { expectedBranchId } } : {}),
    });

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "fetch branch system templates");
  }
}
