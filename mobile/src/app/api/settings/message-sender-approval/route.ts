import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend RequestMessageSenderApprovalDto: senderPhone is @IsString()
// @IsNotEmpty() @MaxLength(20) required. Passthrough preserves any
// forward-compatible fields.
const requestMessageSenderApprovalSchema = z
  .object({
    senderPhone: z.string().min(1).max(20),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  try {
    const response = await serverAPIClient.get("/settings/message-sender-approval", {
      headers: getAuthHeaders(token),
    });

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "message sender approval fetch");
  }
}

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  const { data, response: invalid } = await parseBody(
    requestMessageSenderApprovalSchema,
    request,
  );
  if (invalid) {
    return invalid;
  }

  try {
    const response = await serverAPIClient.post(
      "/settings/message-sender-approval/request",
      data,
      {
        headers: getAuthHeaders(token),
      },
    );

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "message sender approval request");
  }
}
