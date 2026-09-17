import { NextRequest } from "next/server";

import {
  backendJsonResponse,
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
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { branchId } = await context.params;

  try {
    return backendJsonResponse(
      await serverAPIClient.post(
        `/settings/message-sender-approval/${encodeURIComponent(branchId)}/approve`,
        {},
        { headers: getAuthHeaders(token) },
      ),
    );
  } catch (error) {
    return errorResponse(error, "approve message sender request");
  }
}
