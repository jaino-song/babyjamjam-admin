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

const assignmentBodySchema = z.record(z.string(), z.unknown());

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { id } = await context.params;
  const { data, response: invalid } = await parseBody(assignmentBodySchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.patch(
        `/users/${encodeURIComponent(id)}/account-assignment`,
        data,
        { headers: getAuthHeaders(token) },
      ),
    );
  } catch (error) {
    return errorResponse(error, "update user account assignment");
  }
}
