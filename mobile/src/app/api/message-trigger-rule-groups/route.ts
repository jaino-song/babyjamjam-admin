import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, getAuthToken, getAuthHeaders, readJsonObjectBody, invalidJsonResponse } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedProblemResponse();
  try {
    const headers = getAuthHeaders(token);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
    const endpoint = "/message-trigger-rule-groups" + new URL(request.url).search;
    return backendJsonResponse(await serverAPIClient.get(endpoint, { headers }));
  } catch (error) {
    return invalidJsonResponse(error) ?? errorResponse(error, "message policy request", "read");
  }
}

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedProblemResponse();
  try {
    const headers = getAuthHeaders(token);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
    const endpoint = "/message-trigger-rule-groups" + new URL(request.url).search;
    const body = await readJsonObjectBody(request);
    return backendJsonResponse(await serverAPIClient.post(endpoint, body, { headers }));
  } catch (error) {
    return invalidJsonResponse(error) ?? errorResponse(error, "message policy request", "mutation");
  }
}
