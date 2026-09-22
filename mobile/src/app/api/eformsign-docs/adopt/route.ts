import { NextRequest } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken, parseBody } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

const adoptSchema = z.object({
  documentId: z.string().min(1),
  clientId: z.number().int().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return unauthorizedProblemResponse();
    const { data, response: invalid } = await parseBody(adoptSchema, request);
    if (invalid) return invalid;
    const response = await serverAPIClient.post("/eformsign-docs/adopt", data, { headers: getAuthHeaders(token) });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "adopt eformsign document", "mutation");
  }
}
