import { NextRequest } from "next/server";

import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";
import { z } from "zod";

const branchBodySchema = z.record(z.string(), z.unknown());

interface RouteContext {
  params: Promise<{ branchId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { branchId } = await context.params;
  const { data, response: invalid } = await parseBody(branchBodySchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.patch(
        `/system-admin/branches/${encodeURIComponent(branchId)}`,
        data,
        { headers: getAuthHeaders(token) },
      ),
    );
  } catch (error) {
    return errorResponse(error, "update system admin branch");
  }
}
