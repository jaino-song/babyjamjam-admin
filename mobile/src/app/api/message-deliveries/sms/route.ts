import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  getUpstreamErrorStatus,
  logUpstreamError,
  parseBody,
  sanitizeUpstreamClientError,
} from "@/lib/api/route-utils";

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (error && typeof error === "object" && "response" in error) {
      const axiosErr = error as { response?: { status?: number; data?: unknown } };
      if (axiosErr.response) {
        const status = getUpstreamErrorStatus(error);
        logUpstreamError("API send SMS", error);
        return NextResponse.json(
          sanitizeUpstreamClientError(axiosErr.response.data, "Failed to send SMS"),
          { status },
        );
      }
    }
    logUpstreamError("API send SMS", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 },
    );
  }
}
