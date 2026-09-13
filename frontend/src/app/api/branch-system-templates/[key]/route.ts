import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  readJsonObjectBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

interface RouteContext {
  params: Promise<{ key: string }>;
}

function getExpectedBranchId(request: NextRequest): string | undefined {
  const value = request.nextUrl.searchParams.get("expectedBranchId")?.trim();
  return value || undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const { key } = await context.params;
    const expectedBranchId = getExpectedBranchId(request);
    const response = await serverAPIClient.get(
      `/branch-system-templates/${encodeURIComponent(key)}`,
      {
        headers: getAuthHeaders(token),
        ...(expectedBranchId ? { params: { expectedBranchId } } : {}),
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "fetch branch system template");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  try {
    const { key } = await context.params;
    const body = await readJsonObjectBody(request);
    const expectedBranchId = getExpectedBranchId(request);
    const response = await serverAPIClient.put(
      `/branch-system-templates/${encodeURIComponent(key)}`,
      body,
      {
        headers: getAuthHeaders(token),
        ...(expectedBranchId ? { params: { expectedBranchId } } : {}),
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) return invalidJson;
    return errorResponse(error, "update branch system template");
  }
}
