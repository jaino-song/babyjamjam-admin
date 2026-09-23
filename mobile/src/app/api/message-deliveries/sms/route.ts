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

// Mirrors backend SendSmsMessageDto. This is a PAID send path, so the two
// fields the backend marks @IsNotEmpty — receiver and message — are required
// here; the receiver pattern and message length cap match the DTO. Optional
// fields (title, msgType, triggerType, scheduledDate/Time, etc.) passthrough.
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

    const response = await serverAPIClient.post("/message-deliveries/sms", data, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "send SMS delivery", "mutation");
  }
}
