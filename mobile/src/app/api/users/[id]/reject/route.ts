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
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { id } = await context.params;

  try {
    return backendJsonResponse(
      await serverAPIClient.post(
        `/users/${encodeURIComponent(id)}/reject`,
        {},
        { headers: getAuthHeaders(token) },
      ),
    );
  } catch (error) {
    return errorResponse(error, "reject user");
  }
}
