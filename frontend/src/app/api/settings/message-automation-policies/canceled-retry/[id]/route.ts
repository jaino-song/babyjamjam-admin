import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken, localProblemResponse, parseBody, withNoStore } from "@/lib/api/route-utils";

const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();

    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/.test(id)) {
      return localProblemResponse("VALIDATION_FAILED");
    }

    const { data, response: invalidBody } = await parseBody(updateSchema, request);
    if (invalidBody) return invalidBody;

    const response = await serverAPIClient.put(
      `/settings/message-automation-policies/canceled-retry/${encodeURIComponent(id)}`,
      data,
      {
        headers: getAuthHeaders(token),
        params: { expectedBranchId: request.nextUrl.searchParams.get("expectedBranchId") },
      },
    );
    return withNoStore(backendJsonResponse(response));
  } catch (error) {
    return errorResponse(error, "update canceled automation retry settings", "mutation");
  }
}
