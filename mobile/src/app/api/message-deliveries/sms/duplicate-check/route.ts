import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

// Read-only duplicate admission uses the same payload as the send endpoint.
// Preserve every optional binding field for the backend payload hash.
const sendSmsSchema = z
  .object({
    receiver: z
      .string()
      .min(1)
      .regex(/^[0-9,\-\s]+$/, "수신자 연락처 형식이 올바르지 않습니다."),
    message: z.string().min(1).max(2000),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedProblemResponse();
    }

    const { data, response: invalidBody } = await parseBody(sendSmsSchema, request);
    if (invalidBody) {
      return invalidBody;
    }

    const headers: Record<string, string> = { ...getAuthHeaders(token) };
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
    const response = await serverAPIClient.post(`/message-deliveries/sms/duplicate-check${request.nextUrl.search}`, data, {
      headers,
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "check SMS duplicates", "mutation");
  }
}
