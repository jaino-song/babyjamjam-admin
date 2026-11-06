import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, getAuthToken, getAuthHeaders, readJsonObjectBody, invalidJsonResponse } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedProblemResponse();
  try {
    const headers = getAuthHeaders(token);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
    const endpoint = "/message-trigger-rule-groups/" + encodeURIComponent((await context.params).id) + new URL(request.url).search;
    const body = await readJsonObjectBody(request);
    return backendJsonResponse(await serverAPIClient.put(endpoint, body, { headers }));
  } catch (error) {
    return invalidJsonResponse(error) ?? errorResponse(error, "message policy request", "mutation");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedProblemResponse();
  try {
    const headers = getAuthHeaders(token);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
    const endpoint = "/message-trigger-rule-groups/" + encodeURIComponent((await context.params).id) + new URL(request.url).search;
    const body = await readJsonObjectBody(request);
    return backendJsonResponse(await serverAPIClient.delete(endpoint, { headers, data: body }));
  } catch (error) {
    return invalidJsonResponse(error) ?? errorResponse(error, "message policy request", "mutation");
  }
}
