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

const approvalBodySchema = z.record(z.string(), z.unknown());

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { id } = await context.params;
  const { data, response: invalid } = await parseBody(approvalBodySchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.post(
        `/users/${encodeURIComponent(id)}/approve`,
        data,
        { headers: getAuthHeaders(token) },
      ),
    );
  } catch (error) {
    return errorResponse(error, "approve user");
  }
}
