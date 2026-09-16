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

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { data, response: invalid } = await parseBody(branchBodySchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.post("/system-admin/branches", data, {
        headers: getAuthHeaders(token),
      }),
    );
  } catch (error) {
    return errorResponse(error, "create system admin branch");
  }
}
